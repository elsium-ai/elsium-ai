import type { z } from 'zod'
import type { SemanticValidator } from '../semantic-guardrails'
import type { ValidationFailure, ValidationOutcome, Validator } from './types'

export interface ZodValidatorOptions {
	name?: string
	maxIssues?: number
}

export function zodValidator<T>(
	schema: z.ZodType<T>,
	options: ZodValidatorOptions = {},
): Validator<T> {
	const name = options.name ?? 'zod'
	const maxIssues = options.maxIssues ?? 10

	return {
		name,
		validate(value): ValidationOutcome {
			const parsed = schema.safeParse(value)
			if (parsed.success) return { valid: true, failures: [] }

			const issues = parsed.error.issues.slice(0, maxIssues)
			const failures: ValidationFailure[] = issues.map((issue) => ({
				validator: name,
				reason: issue.message,
				detail: { path: issue.path, code: issue.code },
				repairHint: `Fix field at path ${issue.path.join('.') || '<root>'}: ${issue.message}`,
			}))
			return { valid: false, failures }
		},
	}
}

/**
 * Alias for `zodValidator` matching the public spec naming for the fluent
 * `agent.withVerifier(schemaValidator(MySchema))` pattern.
 */
export const schemaValidator = zodValidator

export interface JudgeResult {
	passed: boolean
	score: number
	reason?: string
}

export interface JudgeValidatorOptions {
	name?: string
	rubric: string
	judge: (rubric: string, value: unknown) => Promise<JudgeResult> | JudgeResult
	threshold?: number
}

/**
 * Validator that asks an LLM-as-judge whether `value` satisfies `rubric`.
 * The caller supplies the actual judge function (typically an LLM call against
 * a calibrated prompt) so the framework stays provider-agnostic.
 */
export function judgeValidator<T = unknown>(options: JudgeValidatorOptions): Validator<T> {
	const name = options.name ?? 'judge'
	const threshold = options.threshold ?? 0.5

	return {
		name,
		async validate(value): Promise<ValidationOutcome> {
			const verdict = await options.judge(options.rubric, value)
			if (verdict.passed && verdict.score >= threshold) {
				return { valid: true, failures: [] }
			}
			return {
				valid: false,
				failures: [
					{
						validator: name,
						reason: verdict.reason ?? `judge score ${verdict.score} below threshold ${threshold}`,
						detail: { score: verdict.score, rubric: options.rubric },
						repairHint: `Revise the output to satisfy: ${options.rubric}`,
					},
				],
			}
		},
	}
}

export interface RegexValidatorOptions {
	name?: string
	mode?: 'must-match' | 'must-not-match'
	repairHint?: string
}

export function regexValidator(
	pattern: RegExp,
	options: RegexValidatorOptions = {},
): Validator<string> {
	const name = options.name ?? 'regex'
	const mode = options.mode ?? 'must-match'

	return {
		name,
		validate(value): ValidationOutcome {
			const text = typeof value === 'string' ? value : String(value)
			const matches = pattern.test(text)
			const ok = mode === 'must-match' ? matches : !matches
			if (ok) return { valid: true, failures: [] }
			return {
				valid: false,
				failures: [
					{
						validator: name,
						reason:
							mode === 'must-match'
								? `value did not match required pattern ${pattern}`
								: `value matched forbidden pattern ${pattern}`,
						repairHint:
							options.repairHint ??
							(mode === 'must-match'
								? `Output must satisfy pattern ${pattern}.`
								: `Output must NOT contain pattern ${pattern}.`),
					},
				],
			}
		},
	}
}

export interface SemanticAdapterOptions {
	name?: string
	input: string | (() => string)
	threshold?: number
}

export function semanticAdapter(
	validator: SemanticValidator,
	options: SemanticAdapterOptions,
): Validator<string> {
	const name = options.name ?? 'semantic'
	const threshold = options.threshold ?? 0.5

	return {
		name,
		async validate(value): Promise<ValidationOutcome> {
			const input = typeof options.input === 'function' ? options.input() : options.input
			const result = await validator.validate(input, value)
			if (result.valid) return { valid: true, failures: [] }

			const failures: ValidationFailure[] = result.checks
				.filter((c) => !c.passed || c.score < threshold)
				.map((c) => ({
					validator: `${name}:${c.name}`,
					reason: c.reason,
					detail: { score: c.score },
					repairHint: `Address the ${c.name} concern: ${c.reason}`,
				}))

			if (failures.length === 0) return { valid: true, failures: [] }
			return { valid: false, failures }
		},
	}
}

export interface ExternalValidatorOptions {
	name: string
	repairHint?: string | ((value: unknown) => string)
}

export type ExternalCheck<T> = (value: T) => Promise<{
	valid: boolean
	reason?: string
	detail?: Record<string, unknown>
}>

export function externalValidator<T>(
	check: ExternalCheck<T>,
	options: ExternalValidatorOptions,
): Validator<T> {
	return {
		name: options.name,
		async validate(value): Promise<ValidationOutcome> {
			const result = await check(value)
			if (result.valid) return { valid: true, failures: [] }
			const repairHint =
				typeof options.repairHint === 'function' ? options.repairHint(value) : options.repairHint
			return {
				valid: false,
				failures: [
					{
						validator: options.name,
						reason: result.reason ?? 'external check failed',
						detail: result.detail,
						repairHint,
					},
				],
			}
		},
	}
}
