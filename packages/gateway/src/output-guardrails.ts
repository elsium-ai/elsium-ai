import type { Middleware } from '@elsium-ai/core'
import { ElsiumError, createLogger, extractText } from '@elsium-ai/core'

const log = createLogger()

export interface OutputViolation {
	type: 'pii' | 'content_policy' | 'custom_rule'
	detail: string
	pattern?: string
}

export interface OutputGuardrailRule {
	name: string
	pattern: RegExp
	message?: string
}

export interface OutputGuardrailConfig {
	piiDetection?: boolean
	contentPolicy?: {
		blockedPatterns?: RegExp[]
		maxResponseLength?: number
	}
	customRules?: OutputGuardrailRule[]
	onViolation?: 'block' | 'redact' | 'warn'
	onViolationCallback?: (violation: OutputViolation) => void
}

const PII_PATTERNS: Array<{ pattern: RegExp; label: string; replacement: string }> = [
	{
		pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
		label: 'email',
		replacement: '[REDACTED_EMAIL]',
	},
	{
		pattern: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
		label: 'phone',
		replacement: '[REDACTED_PHONE]',
	},
	{
		pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
		label: 'ssn',
		replacement: '[REDACTED_SSN]',
	},
	{
		pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
		label: 'credit_card',
		replacement: '[REDACTED_CC]',
	},
]

const SECRET_PATTERNS: Array<{ pattern: RegExp; label: string; replacement: string }> = [
	{
		pattern: /\bsk-[A-Za-z0-9]{20,}\b/g,
		label: 'api_key',
		replacement: '[REDACTED_API_KEY]',
	},
	{
		pattern: /\bpk-[A-Za-z0-9]{20,}\b/g,
		label: 'api_key',
		replacement: '[REDACTED_API_KEY]',
	},
	{
		pattern: /\bAKIA[A-Z0-9]{16}\b/g,
		label: 'aws_key',
		replacement: '[REDACTED_AWS_KEY]',
	},
]

function detectPII(text: string): OutputViolation[] {
	const violations: OutputViolation[] = []
	const normalized = text.normalize('NFKC')

	for (const { pattern, label } of [...PII_PATTERNS, ...SECRET_PATTERNS]) {
		const regex = new RegExp(pattern.source, pattern.flags)
		if (regex.test(normalized)) {
			violations.push({
				type: 'pii',
				detail: `Detected ${label} in output`,
				pattern: label,
			})
		}
	}
	return violations
}

function redactPII(text: string): string {
	let result = text
	for (const { pattern, replacement } of [...PII_PATTERNS, ...SECRET_PATTERNS]) {
		const regex = new RegExp(pattern.source, pattern.flags)
		result = result.replace(regex, replacement)
	}
	return result
}

function checkContentPolicy(
	text: string,
	policy: NonNullable<OutputGuardrailConfig['contentPolicy']>,
): OutputViolation[] {
	const violations: OutputViolation[] = []

	if (policy.maxResponseLength && text.length > policy.maxResponseLength) {
		violations.push({
			type: 'content_policy',
			detail: `Response length ${text.length} exceeds max ${policy.maxResponseLength}`,
		})
	}

	if (policy.blockedPatterns) {
		for (const pattern of policy.blockedPatterns) {
			if (pattern.test(text)) {
				violations.push({
					type: 'content_policy',
					detail: `Response matches blocked pattern: ${pattern.source}`,
					pattern: pattern.source,
				})
			}
		}
	}

	return violations
}

function checkCustomRules(text: string, rules: OutputGuardrailRule[]): OutputViolation[] {
	const violations: OutputViolation[] = []
	for (const rule of rules) {
		if (rule.pattern.test(text)) {
			violations.push({
				type: 'custom_rule',
				detail: rule.message ?? `Output matched custom rule: ${rule.name}`,
				pattern: rule.pattern.source,
			})
		}
	}
	return violations
}

export function outputGuardrailMiddleware(config: OutputGuardrailConfig): Middleware {
	const mode = config.onViolation ?? 'block'

	return async (ctx, next) => {
		const response = await next(ctx)
		const text = extractText(response.message.content)
		const violations: OutputViolation[] = []

		if (config.piiDetection) {
			violations.push(...detectPII(text))
		}

		if (config.contentPolicy) {
			violations.push(...checkContentPolicy(text, config.contentPolicy))
		}

		if (config.customRules?.length) {
			violations.push(...checkCustomRules(text, config.customRules))
		}

		if (violations.length === 0) return response

		for (const v of violations) {
			config.onViolationCallback?.(v)
		}

		switch (mode) {
			case 'block':
				throw ElsiumError.validation(
					`Output guardrail violation: ${violations.map((v) => v.detail).join('; ')}`,
					{ violations },
				)

			case 'redact': {
				let redacted = text
				if (config.piiDetection) {
					redacted = redactPII(redacted)
				}
				return {
					...response,
					message: { ...response.message, content: redacted },
				}
			}

			case 'warn':
				log.warn('Output guardrail violations detected', { violations })
				return response
		}
	}
}
