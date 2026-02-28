// ─── Types ──────────────────────────────────────────────────────

export interface AgentSecurityConfig {
	detectPromptInjection?: boolean
	detectJailbreak?: boolean
	redactSecrets?: boolean
	blockedPatterns?: RegExp[]
}

export interface AgentSecurityResult {
	safe: boolean
	violations: Array<{ type: string; detail: string; severity: 'low' | 'medium' | 'high' }>
	redactedOutput?: string
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
	{ pattern: /\bDAN\b.*(?:mode|prompt|jailbreak)/i, detail: 'DAN jailbreak attempt' },
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
		pattern: /developer\s+mode\s+(?:enabled|activated|on)/i,
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

const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string; detail: string }> = [
	{
		pattern: /\bsk-[a-zA-Z0-9_-]{20,}\b/g,
		detail: 'API secret key detected',
		replacement: '[REDACTED_API_KEY]',
	},
	{
		pattern: /\bpk-[a-zA-Z0-9_-]{20,}\b/g,
		detail: 'API public key detected',
		replacement: '[REDACTED_API_KEY]',
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

// ─── Helpers ────────────────────────────────────────────────────

function matchPatterns(
	text: string,
	patterns: Array<{ pattern: RegExp; detail: string }>,
	type: string,
	severity: 'low' | 'medium' | 'high',
): AgentSecurityResult['violations'] {
	const violations: AgentSecurityResult['violations'] = []
	for (const { pattern, detail } of patterns) {
		if (pattern.test(text)) {
			violations.push({ type, detail, severity })
		}
	}
	return violations
}

// ─── Factory ────────────────────────────────────────────────────

export function createAgentSecurity(config: AgentSecurityConfig): {
	validateInput(input: string): AgentSecurityResult
	sanitizeOutput(output: string): AgentSecurityResult
} {
	function validateInput(input: string): AgentSecurityResult {
		const violations: AgentSecurityResult['violations'] = []

		if (config.detectPromptInjection !== false) {
			violations.push(...matchPatterns(input, INJECTION_PATTERNS, 'prompt_injection', 'high'))
		}

		if (config.detectJailbreak) {
			violations.push(...matchPatterns(input, JAILBREAK_PATTERNS, 'jailbreak', 'high'))
		}

		if (config.blockedPatterns?.length) {
			for (const pattern of config.blockedPatterns) {
				if (pattern.test(input)) {
					violations.push({
						type: 'blocked_pattern',
						detail: `Blocked pattern matched: ${pattern.source}`,
						severity: 'medium',
					})
				}
			}
		}

		return { safe: violations.length === 0, violations }
	}

	function sanitizeOutput(output: string): AgentSecurityResult {
		const violations: AgentSecurityResult['violations'] = []
		let redactedOutput = output

		if (config.redactSecrets !== false) {
			for (const { pattern, detail, replacement } of SECRET_PATTERNS) {
				const regex = new RegExp(pattern.source, pattern.flags)
				if (regex.test(redactedOutput)) {
					violations.push({ type: 'secret_detected', detail, severity: 'medium' })
					redactedOutput = redactedOutput.replace(
						new RegExp(pattern.source, pattern.flags),
						replacement,
					)
				}
			}
		}

		return {
			safe: violations.length === 0,
			violations,
			redactedOutput: violations.length > 0 ? redactedOutput : undefined,
		}
	}

	return { validateInput, sanitizeOutput }
}
