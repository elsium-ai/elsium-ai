/**
 * PII classification + jurisdiction routing (G5).
 *
 * Two ports composed:
 *  1. PiiClassifier: scans a text for PII, returns classified matches
 *     (email / phone / ssn / credit_card / passport / ip_address).
 *     Built-in regex classifier ships; users register custom classes via
 *     `extendClassifier`.
 *  2. JurisdictionRouter: given detected PII classes + the tenant's
 *     jurisdiction, returns the allowed provider list. The class →
 *     allowed-providers mapping is the user's policy, not ours; the
 *     framework provides the engine, not the rules.
 *
 * Why ports (not opinionated rules): jurisdictions and data
 * classifications are regulatory decisions that vary by country, by
 * industry, and over time. The framework cannot hard-code "EU PII must
 * go to Azure-EU"; the user encodes their own legal interpretation.
 */

// ─── PII class taxonomy ─────────────────────────────────────────

export type PiiClass =
	| 'email'
	| 'phone'
	| 'ssn'
	| 'credit_card'
	| 'passport'
	| 'ip_address'
	| (string & {})

export interface PiiMatch {
	readonly piiClass: PiiClass
	readonly start: number
	readonly end: number
	readonly matchedText: string
}

// ─── Classifier port + built-in adapter ─────────────────────────

export interface PiiClassifier {
	classify(text: string): readonly PiiMatch[]
	register(piiClass: PiiClass, pattern: RegExp): void
	readonly classes: readonly PiiClass[]
}

const DEFAULT_PATTERNS: Array<{ piiClass: PiiClass; pattern: RegExp }> = [
	{ piiClass: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
	{ piiClass: 'phone', pattern: /\b(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g },
	{ piiClass: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
	{ piiClass: 'credit_card', pattern: /\b(?:\d[ -]*?){13,16}\b/g },
	{ piiClass: 'passport', pattern: /\b[A-Z]{1,2}\d{6,9}\b/g },
	{ piiClass: 'ip_address', pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
]

export function createPiiClassifier(): PiiClassifier {
	const patterns: Array<{ piiClass: PiiClass; pattern: RegExp }> = DEFAULT_PATTERNS.map((p) => ({
		piiClass: p.piiClass,
		pattern: new RegExp(p.pattern.source, p.pattern.flags),
	}))

	return {
		get classes(): readonly PiiClass[] {
			return [...new Set(patterns.map((p) => p.piiClass))]
		},

		register(piiClass: PiiClass, pattern: RegExp): void {
			const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
			patterns.push({ piiClass, pattern: new RegExp(pattern.source, flags) })
		},

		classify(text: string): readonly PiiMatch[] {
			const matches: PiiMatch[] = []
			for (const { piiClass, pattern } of patterns) {
				pattern.lastIndex = 0
				let m: RegExpExecArray | null
				m = pattern.exec(text)
				while (m !== null) {
					matches.push({
						piiClass,
						start: m.index,
						end: m.index + m[0].length,
						matchedText: m[0],
					})
					if (m.index === pattern.lastIndex) pattern.lastIndex++
					m = pattern.exec(text)
				}
			}
			return matches
		},
	}
}

// ─── Jurisdiction router (port + reference impl) ────────────────

export interface JurisdictionPolicy {
	/**
	 * For each jurisdiction (e.g. 'eu', 'us', 'asia'), per PII class → list of
	 * provider IDs allowed to receive that data class. The special key '*'
	 * applies when no specific class matches the entry. The fallback
	 * `default` jurisdiction applies when the request's jurisdiction is
	 * unknown.
	 */
	readonly byJurisdiction: Readonly<Record<string, JurisdictionRules>>
	readonly default?: JurisdictionRules
}

export interface JurisdictionRules {
	readonly classProviders: Readonly<Record<PiiClass | '*', readonly string[]>>
}

export interface JurisdictionResolution {
	readonly detectedClasses: readonly PiiClass[]
	readonly allowedProviders: readonly string[]
	readonly deniedProviders: readonly string[]
	readonly jurisdictionUsed: string | 'default' | 'none'
	readonly reason: string
}

export interface JurisdictionRouter {
	resolveProviders(
		text: string,
		options: { jurisdiction?: string; candidateProviders: readonly string[] },
	): JurisdictionResolution
}

export interface JurisdictionRouterConfig {
	readonly classifier?: PiiClassifier
	readonly policy: JurisdictionPolicy
}

function intersect(a: readonly string[], b: readonly string[]): string[] {
	return a.filter((x) => b.includes(x))
}

function resolveJurisdictionRules(
	policy: JurisdictionPolicy,
	requested: string | undefined,
): { rules: JurisdictionRules | undefined; jurisdictionUsed: string } {
	if (requested && requested in policy.byJurisdiction) {
		return { rules: policy.byJurisdiction[requested], jurisdictionUsed: requested }
	}
	return { rules: policy.default, jurisdictionUsed: 'default' }
}

type AllowedSetResult =
	| { readonly ok: true; readonly allowed: readonly string[] }
	| { readonly ok: false; readonly blockingClass: PiiClass }

function computeAllowedSet(
	detectedClasses: readonly PiiClass[],
	rules: JurisdictionRules,
	candidates: readonly string[],
): AllowedSetResult {
	if (detectedClasses.length === 0) {
		return { ok: true, allowed: rules.classProviders['*'] ?? candidates }
	}
	let working: readonly string[] = candidates
	for (const c of detectedClasses) {
		const ruleAllowed = rules.classProviders[c] ?? rules.classProviders['*']
		if (!ruleAllowed) return { ok: false, blockingClass: c }
		working = intersect(working, ruleAllowed)
		if (working.length === 0) break
	}
	return { ok: true, allowed: working }
}

export function createJurisdictionRouter(config: JurisdictionRouterConfig): JurisdictionRouter {
	const classifier = config.classifier ?? createPiiClassifier()

	return {
		resolveProviders(text, options) {
			const matches = classifier.classify(text)
			const detectedClasses = [...new Set(matches.map((m) => m.piiClass))]

			const { rules, jurisdictionUsed } = resolveJurisdictionRules(
				config.policy,
				options.jurisdiction,
			)

			if (!rules) {
				return {
					detectedClasses,
					allowedProviders: [...options.candidateProviders],
					deniedProviders: [],
					jurisdictionUsed: 'none',
					reason: 'No jurisdiction policy configured; all candidates allowed',
				}
			}

			const computation = computeAllowedSet(detectedClasses, rules, options.candidateProviders)
			if (!computation.ok) {
				return {
					detectedClasses,
					allowedProviders: [],
					deniedProviders: [...options.candidateProviders],
					jurisdictionUsed,
					reason: `No rule for class "${computation.blockingClass}" in jurisdiction "${jurisdictionUsed}" (no fallback '*' either); denying all`,
				}
			}

			const allowedProviders = intersect(options.candidateProviders, computation.allowed)
			const deniedProviders = options.candidateProviders.filter(
				(p) => !allowedProviders.includes(p),
			)

			return {
				detectedClasses,
				allowedProviders,
				deniedProviders,
				jurisdictionUsed,
				reason:
					detectedClasses.length === 0
						? `No PII detected; applied '*' rule for "${jurisdictionUsed}"`
						: `Detected [${detectedClasses.join(', ')}]; intersection of allowed providers under "${jurisdictionUsed}"`,
			}
		},
	}
}
