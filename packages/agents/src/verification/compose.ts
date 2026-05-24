import type { ValidationContext, ValidationOutcome, Validator } from './types'

export interface ComposeValidatorsOptions {
	name?: string
	mode?: 'all' | 'short-circuit'
}

export function composeValidators<T>(
	validators: Validator<T>[],
	options: ComposeValidatorsOptions = {},
): Validator<T> {
	const mode = options.mode ?? 'all'
	const name = options.name ?? `composed(${validators.map((v) => v.name).join(',')})`

	return {
		name,
		async validate(value: T, context: ValidationContext): Promise<ValidationOutcome> {
			const failures: ValidationOutcome['failures'] = []
			for (const validator of validators) {
				const result = await validator.validate(value, context)
				if (!result.valid) {
					failures.push(...result.failures)
					if (mode === 'short-circuit') break
				}
			}
			return { valid: failures.length === 0, failures }
		},
	}
}
