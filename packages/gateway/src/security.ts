import type { LLMResponse, Middleware, MiddlewareContext, MiddlewareNext } from '@elsium-ai/core'
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
	blockedPatterns?: RegExp[]
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

const SECRET_PATTERNS: Array<{ pattern: RegExp; detail: string; replacement: string }> = [
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

// ─── Detection Functions ────────────────────────────────────────

// M6 fix: Normalize Unicode (NFKC) before security pattern matching to prevent bypass via confusables
function normalizeText(text: string): string {
	return text.normalize('NFKC')
}

export function detectPromptInjection(text: string): SecurityViolation[] {
	const violations: SecurityViolation[] = []
	const normalized = normalizeText(text)
	for (const { pattern, detail } of INJECTION_PATTERNS) {
		if (pattern.test(normalized)) {
			violations.push({ type: 'prompt_injection', detail, severity: 'high' })
		}
	}
	return violations
}

export function detectJailbreak(text: string): SecurityViolation[] {
	const violations: SecurityViolation[] = []
	const normalized = normalizeText(text)
	for (const { pattern, detail } of JAILBREAK_PATTERNS) {
		if (pattern.test(normalized)) {
			violations.push({ type: 'jailbreak', detail, severity: 'high' })
		}
	}
	return violations
}

export function redactSecrets(text: string): { redacted: string; found: SecurityViolation[] } {
	const found: SecurityViolation[] = []
	let redacted = text

	for (const { pattern, detail, replacement } of SECRET_PATTERNS) {
		const regex = new RegExp(pattern.source, pattern.flags)
		if (regex.test(redacted)) {
			found.push({ type: 'secret_detected', detail, severity: 'medium' })
			redacted = redacted.replace(new RegExp(pattern.source, pattern.flags), replacement)
		}
	}

	return { redacted, found }
}

export function checkBlockedPatterns(text: string, patterns: RegExp[]): SecurityViolation[] {
	const violations: SecurityViolation[] = []
	for (const pattern of patterns) {
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

export function securityMiddleware(config: SecurityMiddlewareConfig): Middleware {
	return async (ctx: MiddlewareContext, next: MiddlewareNext): Promise<LLMResponse> => {
		// Pre-processing: scan input messages
		for (const message of ctx.request.messages) {
			const text = extractText(message.content)
			if (!text) continue

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

			if (violations.length > 0) {
				for (const v of violations) {
					config.onViolation?.(v)
				}
				throw ElsiumError.validation(
					`Security violation detected: ${violations.map((v) => v.detail).join('; ')}`,
				)
			}
		}

		// Execute the next middleware / provider call
		const response = await next(ctx)

		// Post-processing: redact secrets in response
		if (config.secretRedaction !== false) {
			const responseText = extractText(response.message.content)
			if (responseText) {
				const { redacted, found } = redactSecrets(responseText)
				if (found.length > 0) {
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
			}
		}

		return response
	}
}
