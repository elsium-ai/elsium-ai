export interface ValidationFailure {
	validator: string
	reason: string
	detail?: Record<string, unknown>
	repairHint?: string
}

export interface ValidationOutcome {
	valid: boolean
	failures: ValidationFailure[]
}

export interface ValidationContext {
	attempt: number
	previousFailures: ValidationFailure[]
	metadata?: Record<string, unknown>
}

export interface Validator<T = unknown> {
	readonly name: string
	validate(value: T, context: ValidationContext): Promise<ValidationOutcome> | ValidationOutcome
}

export interface RepairContext {
	attempt: number
	previousValue: unknown
	failures: ValidationFailure[]
	repairPrompt: string
}

export interface VerificationAttempt<T> {
	attempt: number
	value: T
	outcome: ValidationOutcome
	durationMs: number
}

export interface VerificationSuccess<T> {
	status: 'ok' | 'repaired'
	value: T
	attempts: number
	history: VerificationAttempt<T>[]
}

export interface VerificationAbort<T> {
	status: 'aborted'
	lastValue: T | undefined
	attempts: number
	history: VerificationAttempt<T>[]
	reason: 'max-repairs-exceeded' | 'unrecoverable'
}

export type VerificationOutcome<T> = VerificationSuccess<T> | VerificationAbort<T>

export interface VerificationConfig<T> {
	validators: Validator<T>[]
	maxRepairs?: number
	formatRepairPrompt?: (failures: ValidationFailure[], previousValue: T) => string
	onAttempt?: (attempt: VerificationAttempt<T>) => void
	onAbort?: (abort: VerificationAbort<T>) => void
}

export type GenerateFn<T> = (repair?: RepairContext) => Promise<T>
