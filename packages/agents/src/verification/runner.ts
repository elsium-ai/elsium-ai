import { composeValidators } from './compose'
import type {
	GenerateFn,
	RepairContext,
	ValidationFailure,
	VerificationAttempt,
	VerificationConfig,
	VerificationOutcome,
} from './types'

const DEFAULT_MAX_REPAIRS = 3

function defaultRepairPrompt(failures: ValidationFailure[], previousValue: unknown): string {
	const bullets = failures
		.map((f) => `- [${f.validator}] ${f.reason}${f.repairHint ? ` → ${f.repairHint}` : ''}`)
		.join('\n')
	const preview =
		typeof previousValue === 'string'
			? previousValue.slice(0, 500)
			: JSON.stringify(previousValue, null, 2).slice(0, 500)
	return `The previous output failed verification with these issues:\n${bullets}\n\nPrevious output (truncated):\n${preview}\n\nProduce a new output that fixes every issue above.`
}

export async function runWithVerification<T>(
	generate: GenerateFn<T>,
	config: VerificationConfig<T>,
): Promise<VerificationOutcome<T>> {
	if (!config.validators?.length) {
		throw new Error('runWithVerification requires at least one validator')
	}

	const maxRepairs = config.maxRepairs ?? DEFAULT_MAX_REPAIRS
	const combined = composeValidators(config.validators, { mode: 'all' })
	const formatRepair = config.formatRepairPrompt ?? defaultRepairPrompt

	const history: VerificationAttempt<T>[] = []
	let previousValue: T | undefined
	let previousFailures: ValidationFailure[] = []

	for (let attempt = 0; attempt <= maxRepairs; attempt++) {
		const repair: RepairContext | undefined =
			attempt === 0 || previousValue === undefined
				? undefined
				: {
						attempt,
						previousValue,
						failures: previousFailures,
						repairPrompt: formatRepair(previousFailures, previousValue),
					}

		const startedAt = Date.now()
		const value = await generate(repair)
		const outcome = await combined.validate(value, {
			attempt,
			previousFailures,
		})
		const durationMs = Date.now() - startedAt

		const attemptRecord: VerificationAttempt<T> = {
			attempt,
			value,
			outcome,
			durationMs,
		}
		history.push(attemptRecord)
		config.onAttempt?.(attemptRecord)

		if (outcome.valid) {
			return {
				status: attempt === 0 ? 'ok' : 'repaired',
				value,
				attempts: attempt + 1,
				history,
			}
		}

		previousValue = value
		previousFailures = outcome.failures
	}

	const abort: VerificationOutcome<T> = {
		status: 'aborted',
		lastValue: previousValue,
		attempts: history.length,
		history,
		reason: 'max-repairs-exceeded',
	}
	config.onAbort?.(abort)
	return abort
}
