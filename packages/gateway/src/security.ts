import type {
	LLMResponse,
	Message,
	Middleware,
	MiddlewareContext,
	MiddlewareNext,
} from '@elsium-ai/core'
import { ElsiumError, extractText } from '@elsium-ai/core'

// ─── Types ──────────────────────────────────────────────────────

export interface SecurityViolation {
	type: 'prompt_injection' | 'jailbreak' | 'secret_detected' | 'blocked_pattern'
	detail: string
	severity: 'low' | 'medium' | 'high'
}

export interface SecurityResult {
	safe: boolean
	violations: SecurityViolation[]
}

export interface SecurityMiddlewareConfig {
	promptInjection?: boolean
	secretRedaction?: boolean
	jailbreakDetection?: boolean
	blockedPatterns?: (string | RegExp)[]
	piiTypes?: Array<'email' | 'phone' | 'address' | 'passport' | 'all'>
	/**
	 * Redact secrets (and any `piiTypes`) from the OUTGOING request — system
	 * prompt and input messages — before it reaches the provider. Off by default
	 * to preserve existing behavior. Pairs with `piiTypes` for PII redaction.
	 */
	redactInput?: boolean
	onViolation?: (violation: SecurityViolation) => void
}

// ─── Detection Patterns ─────────────────────────────────────────

const INJECTION_PATTERNS: Array<{ pattern: RegExp; detail: string }> = [
	{
		pattern: /ignore\s+(?:all\s+)?previous\s+instructions/i,
		detail: 'Attempt to override previous instructions',
	},
	{ pattern: /ignore\s+all\s+prior/i, detail: 'Attempt to ignore prior context' },
	{ pattern: /disregard\s+(?:the\s+)?above/i, detail: 'Attempt to disregard above context' },
	{ pattern: /^system\s*:/im, detail: 'Attempt to inject system-level instruction' },
	{ pattern: /<\|system\|>/i, detail: 'Attempt to inject system token' },
	{ pattern: /\[INST\]/i, detail: 'Attempt to inject instruction token' },
	{ pattern: /<<SYS>>/i, detail: 'Attempt to inject system block' },
	{ pattern: /<system>/i, detail: 'Attempt to inject system tag' },
	{
		pattern: /you\s+are\s+now\b.*(?:override|ignore|forget|disregard|new\s+instructions)/i,
		detail: 'Attempt to override agent identity',
	},
]

const JAILBREAK_PATTERNS: Array<{ pattern: RegExp; detail: string }> = [
	{
		pattern: /\bDAN\b.*(?:mode|prompt|jailbreak|do\s+anything|no\s+(?:restrictions|rules|limits))/i,
		detail: 'DAN jailbreak attempt',
	},
	{ pattern: /\bdo\s+anything\s+now\b/i, detail: 'DAN (Do Anything Now) jailbreak attempt' },
	{ pattern: /you\s+are\s+(?:now\s+)?DAN\b/i, detail: 'DAN role assignment jailbreak attempt' },
	{
		pattern:
			/(?:pretend|act\s+as\s+if)\s+(?:you\s+)?(?:have\s+no|don'?t\s+have\s+any?)\s+(?:restrictions|limitations|rules|guidelines)/i,
		detail: 'Attempt to remove restrictions',
	},
	{
		pattern:
			/(?:bypass|circumvent|ignore|disable)\s+(?:your\s+)?(?:safety|content|ethical)\s+(?:filters?|guidelines?|restrictions?|rules?)/i,
		detail: 'Attempt to bypass safety filters',
	},
	{
		pattern:
			/(?:enable|activate|turn\s+on)\s+developer\s+mode|developer\s+mode\s+(?:enabled|activated|on)/i,
		detail: 'Developer mode jailbreak attempt',
	},
	{
		pattern: /(?:unlock|enable)\s+(?:all|unrestricted|unfiltered)\s+(?:mode|access|capabilities)/i,
		detail: 'Attempt to unlock unrestricted mode',
	},
	{
		pattern: /opposite\s+(?:mode|day)|do\s+(?:the\s+)?opposite/i,
		detail: 'Opposite mode jailbreak attempt',
	},
]

const SECRET_PATTERNS: Array<{ pattern: RegExp; detail: string; replacement: string }> = [
	{
		pattern: /\bsk-[a-zA-Z0-9_-]{8,}\b/g,
		detail: 'API secret key detected',
		replacement: '[REDACTED_API_KEY]',
	},
	{
		pattern: /\bpk-[a-zA-Z0-9_-]{8,}\b/g,
		detail: 'API public key detected',
		replacement: '[REDACTED_API_KEY]',
	},
	{
		pattern: /\bghp_[a-zA-Z0-9]{8,}\b/g,
		detail: 'GitHub personal access token detected',
		replacement: '[REDACTED_GITHUB_TOKEN]',
	},
	{
		pattern: /\bgho_[a-zA-Z0-9]{8,}\b/g,
		detail: 'GitHub OAuth token detected',
		replacement: '[REDACTED_GITHUB_TOKEN]',
	},
	{
		pattern: /\bgithub_pat_[a-zA-Z0-9_]{8,}\b/g,
		detail: 'GitHub fine-grained token detected',
		replacement: '[REDACTED_GITHUB_TOKEN]',
	},
	{
		pattern: /\bapi_key[=:]\s*["']?[a-zA-Z0-9_-]{16,}["']?/gi,
		detail: 'API key assignment detected',
		replacement: '[REDACTED_API_KEY]',
	},
	{
		pattern: /\bAKIA[A-Z0-9]{16}\b/g,
		detail: 'AWS access key detected',
		replacement: '[REDACTED_AWS_KEY]',
	},
	{
		pattern: /\bpassword\s*[=:]\s*["']?[^\s"']{4,}["']?/gi,
		detail: 'Password assignment detected',
		replacement: '[REDACTED_PASSWORD]',
	},
	{
		pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
		detail: 'SSN pattern detected',
		replacement: '[REDACTED_SSN]',
	},
	{
		pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
		detail: 'Credit card number detected',
		replacement: '[REDACTED_CC]',
	},
	{
		pattern: /\bBearer\s+[a-zA-Z0-9_.-]{20,}\b/g,
		detail: 'Bearer token detected',
		replacement: '[REDACTED_TOKEN]',
	},
]

// ─── PII Patterns ───────────────────────────────────────────────

const PII_PATTERNS: Record<
	string,
	Array<{ pattern: RegExp; detail: string; replacement: string }>
> = {
	email: [
		{
			pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
			detail: 'Email address detected',
			replacement: '[REDACTED_EMAIL]',
		},
	],
	phone: [
		{
			pattern: /\b(?:\+?1[-.\s]?)?(?:\([2-9]\d{2}\)|[2-9]\d{2})[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
			detail: 'US phone number detected',
			replacement: '[REDACTED_PHONE]',
		},
	],
	address: [
		{
			pattern:
				/\b\d{1,5}\s+[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*){0,5}\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Rd|Road|Ct|Court|Way|Pl|Place)\.?\b/g,
			detail: 'Street address detected',
			replacement: '[REDACTED_ADDRESS]',
		},
	],
	passport: [
		{
			pattern: /\b[A-Z]\d{8}\b/g,
			detail: 'Passport number detected',
			replacement: '[REDACTED_PASSPORT]',
		},
	],
}

// ─── Data Classification ────────────────────────────────────────

export type DataClassification = 'public' | 'internal' | 'confidential' | 'restricted'

export interface ClassificationResult {
	level: DataClassification
	detectedTypes: string[]
}

export function classifyContent(text: string): ClassificationResult {
	const detectedTypes: string[] = []

	// Check secrets (restricted)
	for (const { pattern, detail } of SECRET_PATTERNS) {
		if (new RegExp(pattern.source, pattern.flags).test(text)) {
			detectedTypes.push(detail)
		}
	}

	if (detectedTypes.length > 0) {
		return { level: 'restricted', detectedTypes }
	}

	// Check PII (confidential)
	for (const [, patterns] of Object.entries(PII_PATTERNS)) {
		for (const { pattern, detail } of patterns) {
			if (new RegExp(pattern.source, pattern.flags).test(text)) {
				detectedTypes.push(detail)
			}
		}
	}

	if (detectedTypes.length > 0) {
		return { level: 'confidential', detectedTypes }
	}

	return { level: 'public', detectedTypes: [] }
}

// ─── Detection Functions ────────────────────────────────────────

// Zero-width / invisible characters used to break up keywords and evade matching:
// ZWSP, ZWNJ, ZWJ (U+200B-200D), word joiner (U+2060), BOM (U+FEFF), soft hyphen (U+00AD).
// Built from code points (no regex char class) to avoid joined-sequence pitfalls.
const ZERO_WIDTH_CHARS = [0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00ad].map((c) =>
	String.fromCharCode(c),
)

function stripZeroWidth(text: string): string {
	let out = text
	for (const ch of ZERO_WIDTH_CHARS) out = out.split(ch).join('')
	return out
}

// Common homoglyphs (Cyrillic / Greek lookalikes) folded to ASCII so that
// "іgnоre previous instructions" is matched like its ASCII form. Small on
// purpose — covers realistic evasion, not every Unicode confusable.
const CONFUSABLES: Record<string, string> = {
	а: 'a',
	е: 'e',
	о: 'o',
	р: 'p',
	с: 'c',
	х: 'x',
	у: 'y',
	к: 'k',
	м: 'm',
	н: 'h',
	т: 't',
	в: 'b',
	і: 'i',
	ѕ: 's',
	ј: 'j',
	ԁ: 'd',
	ɡ: 'g',
	ո: 'n',
	ս: 'u',
	α: 'a',
	ο: 'o',
	ε: 'e',
	ρ: 'p',
	ι: 'i',
	ν: 'v',
	τ: 't',
	υ: 'u',
}

function foldConfusables(text: string): string {
	let out = ''
	for (const ch of text) out += CONFUSABLES[ch] ?? ch
	return out
}

/**
 * Normalize text for keyword detection (NOT for redaction): unicode NFKC, strip
 * zero-width chars, fold homoglyphs to ASCII, collapse whitespace, lowercase.
 * Pure, dependency-free, edge-safe. Exported so external guardrails can reuse it.
 */
export function normalizeForDetection(text: string): string {
	return foldConfusables(stripZeroWidth(text.normalize('NFKC')))
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase()
}

const BASE64_SEGMENT = /[A-Za-z0-9+/]{16,}={0,2}/g

/** True if the string is mostly readable ASCII (tab/newline/space..tilde). */
function isMostlyPrintable(s: string): boolean {
	let printable = 0
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i)
		if (c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0x7e)) printable++
	}
	return s.length > 0 && printable / s.length >= 0.85
}

/** Decode long base64 segments and return any printable ASCII payloads found. */
function decodeBase64Payloads(text: string): string {
	const matches = text.match(BASE64_SEGMENT)
	if (!matches) return ''
	const decoded: string[] = []
	for (const segment of matches) {
		try {
			const out = atob(segment)
			// Keep only payloads that look like readable text, not binary noise.
			if (out.length >= 6 && isMostlyPrintable(out)) decoded.push(out)
		} catch {
			/* not valid base64 — ignore */
		}
	}
	return decoded.join(' ')
}

/**
 * Produce the haystack to scan for injection/jailbreak: the normalized text plus
 * any decoded base64 payloads (also normalized). Catches obfuscated attacks
 * without any external dependency or ML model.
 */
export function expandForDetection(text: string): string {
	const normalized = normalizeForDetection(text)
	const decoded = decodeBase64Payloads(text)
	return decoded ? `${normalized} ${normalizeForDetection(decoded)}` : normalized
}

export function detectPromptInjection(text: string): SecurityViolation[] {
	const violations: SecurityViolation[] = []
	const haystack = expandForDetection(text)
	for (const { pattern, detail } of INJECTION_PATTERNS) {
		if (new RegExp(pattern.source, pattern.flags).test(haystack)) {
			violations.push({ type: 'prompt_injection', detail, severity: 'high' })
		}
	}
	return violations
}

export function detectJailbreak(text: string): SecurityViolation[] {
	const violations: SecurityViolation[] = []
	const haystack = expandForDetection(text)
	for (const { pattern, detail } of JAILBREAK_PATTERNS) {
		if (new RegExp(pattern.source, pattern.flags).test(haystack)) {
			violations.push({ type: 'jailbreak', detail, severity: 'high' })
		}
	}
	return violations
}

function redactPatterns(
	text: string,
	patterns: Array<{ pattern: RegExp; detail: string; replacement: string }>,
): { redacted: string; found: SecurityViolation[] } {
	const found: SecurityViolation[] = []
	let redacted = text

	for (const { pattern, detail, replacement } of patterns) {
		const regex = new RegExp(pattern.source, pattern.flags)
		regex.lastIndex = 0
		const result = redacted.replace(regex, replacement)
		if (result !== redacted) {
			found.push({ type: 'secret_detected', detail, severity: 'medium' })
			redacted = result
		}
	}

	return { redacted, found }
}

function resolvePiiPatterns(
	piiTypes: Array<'email' | 'phone' | 'address' | 'passport' | 'all'>,
): Array<{ pattern: RegExp; detail: string; replacement: string }> {
	const typesToCheck = piiTypes.includes('all')
		? Object.keys(PII_PATTERNS)
		: piiTypes.filter((t) => t !== 'all')

	const patterns: Array<{ pattern: RegExp; detail: string; replacement: string }> = []
	for (const type of typesToCheck) {
		const typePatterns = PII_PATTERNS[type]
		if (typePatterns) patterns.push(...typePatterns)
	}
	return patterns
}

export function redactSecrets(
	text: string,
	piiTypes?: Array<'email' | 'phone' | 'address' | 'passport' | 'all'>,
): { redacted: string; found: SecurityViolation[] } {
	const secretResult = redactPatterns(text, SECRET_PATTERNS)
	let { redacted } = secretResult
	const found = [...secretResult.found]

	if (piiTypes?.length) {
		const piiResult = redactPatterns(redacted, resolvePiiPatterns(piiTypes))
		redacted = piiResult.redacted
		found.push(...piiResult.found)
	}

	return { redacted, found }
}

export function checkBlockedPatterns(
	text: string,
	patterns: (string | RegExp)[],
): SecurityViolation[] {
	const violations: SecurityViolation[] = []
	for (const raw of patterns) {
		const pattern = typeof raw === 'string' ? new RegExp(raw, 'i') : raw
		pattern.lastIndex = 0
		if (pattern.test(text)) {
			violations.push({
				type: 'blocked_pattern',
				detail: `Blocked pattern matched: ${pattern.source}`,
				severity: 'medium',
			})
		}
	}
	return violations
}

// ─── Middleware ──────────────────────────────────────────────────

function scanMessageForViolations(
	text: string,
	config: SecurityMiddlewareConfig,
): SecurityViolation[] {
	const violations: SecurityViolation[] = []

	if (config.promptInjection !== false) {
		violations.push(...detectPromptInjection(text))
	}

	if (config.jailbreakDetection) {
		violations.push(...detectJailbreak(text))
	}

	if (config.blockedPatterns?.length) {
		violations.push(...checkBlockedPatterns(text, config.blockedPatterns))
	}

	return violations
}

function reportAndThrow(violations: SecurityViolation[], config: SecurityMiddlewareConfig): never {
	for (const v of violations) {
		config.onViolation?.(v)
	}
	throw ElsiumError.validation(
		`Security violation detected: ${violations.map((v) => v.detail).join('; ')}`,
	)
}

function redactResponseSecrets(
	response: LLMResponse,
	config: SecurityMiddlewareConfig,
): LLMResponse {
	const responseText = extractText(response.message.content)
	if (!responseText) return response

	const { redacted, found } = redactSecrets(responseText, config.piiTypes)
	if (found.length === 0) return response

	for (const v of found) {
		config.onViolation?.(v)
	}
	return {
		...response,
		message: {
			...response.message,
			content: redacted,
		},
	}
}

function redactMessageContent(
	content: Message['content'],
	config: SecurityMiddlewareConfig,
): { content: Message['content']; found: SecurityViolation[] } {
	if (typeof content === 'string') {
		const { redacted, found } = redactSecrets(content, config.piiTypes)
		return { content: redacted, found }
	}
	const found: SecurityViolation[] = []
	const parts = content.map((part) => {
		if (part.type === 'text') {
			const result = redactSecrets(part.text, config.piiTypes)
			found.push(...result.found)
			return result.found.length > 0 ? { ...part, text: result.redacted } : part
		}
		return part
	})
	return { content: parts, found }
}

function redactRequestInput(
	ctx: MiddlewareContext,
	config: SecurityMiddlewareConfig,
): MiddlewareContext {
	const violations: SecurityViolation[] = []

	let system = ctx.request.system
	if (system) {
		const result = redactSecrets(system, config.piiTypes)
		system = result.redacted
		violations.push(...result.found)
	}

	const messages = ctx.request.messages.map((message) => {
		const { content, found } = redactMessageContent(message.content, config)
		violations.push(...found)
		return found.length > 0 ? { ...message, content } : message
	})

	if (violations.length === 0) return ctx

	for (const v of violations) {
		config.onViolation?.(v)
	}
	return { ...ctx, request: { ...ctx.request, system, messages } }
}

/** Scan the system prompt and every input message; throw on the first violation. */
function scanRequestForViolations(ctx: MiddlewareContext, config: SecurityMiddlewareConfig): void {
	if (ctx.request.system) {
		const sysViolations = scanMessageForViolations(ctx.request.system, config)
		if (sysViolations.length > 0) reportAndThrow(sysViolations, config)
	}

	for (const message of ctx.request.messages) {
		const text = extractText(message.content)
		if (!text) continue
		const violations = scanMessageForViolations(text, config)
		if (violations.length > 0) reportAndThrow(violations, config)
	}
}

export function securityMiddleware(config: SecurityMiddlewareConfig): Middleware {
	return async (ctx: MiddlewareContext, next: MiddlewareNext): Promise<LLMResponse> => {
		// Pre-processing: detection (throws on violation)
		scanRequestForViolations(ctx, config)

		// Pre-processing: redact secrets / PII in the outgoing request
		const outgoing = config.redactInput ? redactRequestInput(ctx, config) : ctx

		// Execute the next middleware / provider call
		const response = await next(outgoing)

		// Post-processing: redact secrets in response
		if (config.secretRedaction !== false) {
			return redactResponseSecrets(response, config)
		}

		return response
	}
}
