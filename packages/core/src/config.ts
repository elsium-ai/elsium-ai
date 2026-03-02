import { ElsiumError } from './errors'

function getEnvVar(name: string): string | undefined {
	const value = process.env[name]
	if (value === undefined || value === 'undefined') return undefined
	return value
}

export function env(name: string, fallback?: string): string {
	const value = getEnvVar(name)
	if (value !== undefined) return value
	if (fallback !== undefined) return fallback
	throw new ElsiumError({
		code: 'CONFIG_ERROR',
		message: `Missing required environment variable: ${name}`,
		retryable: false,
		metadata: { variable: name },
	})
}

export function envNumber(name: string, fallback?: number): number {
	const raw = getEnvVar(name)
	if (raw !== undefined) {
		const parsed = Number(raw)
		if (!Number.isFinite(parsed)) {
			throw new ElsiumError({
				code: 'CONFIG_ERROR',
				message: `Environment variable ${name} is not a valid finite number: ${raw}`,
				retryable: false,
				metadata: { variable: name, value: raw },
			})
		}
		return parsed
	}
	if (fallback !== undefined) return fallback
	throw new ElsiumError({
		code: 'CONFIG_ERROR',
		message: `Missing required environment variable: ${name}`,
		retryable: false,
		metadata: { variable: name },
	})
}

export function envBool(name: string, fallback?: boolean): boolean {
	const raw = getEnvVar(name)
	if (raw !== undefined) {
		const normalized = raw.toLowerCase()
		if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
		if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: `Environment variable ${name} has unrecognized boolean value: ${raw}. Expected one of: true, false, 1, 0, yes, no`,
			retryable: false,
			metadata: { variable: name, value: raw },
		})
	}
	if (fallback !== undefined) return fallback
	throw new ElsiumError({
		code: 'CONFIG_ERROR',
		message: `Missing required environment variable: ${name}`,
		retryable: false,
		metadata: { variable: name },
	})
}
