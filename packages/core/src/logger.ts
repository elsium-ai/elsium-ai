export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
	level: LogLevel
	message: string
	timestamp: string
	traceId?: string
	data?: Record<string, unknown>
}

export interface Logger {
	debug(message: string, data?: Record<string, unknown>): void
	info(message: string, data?: Record<string, unknown>): void
	warn(message: string, data?: Record<string, unknown>): void
	error(message: string, data?: Record<string, unknown>): void
	child(context: Record<string, unknown>): Logger
}

const LOG_LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
}

export interface LoggerOptions {
	level?: LogLevel
	pretty?: boolean
	context?: Record<string, unknown>
}

export function createLogger(options: LoggerOptions = {}): Logger {
	const { level = 'info', pretty = false, context = {} } = options
	const minLevel = LOG_LEVELS[level]

	function log(logLevel: LogLevel, message: string, data?: Record<string, unknown>): void {
		if (LOG_LEVELS[logLevel] < minLevel) return

		const entry: LogEntry = {
			...context,
			level: logLevel,
			message,
			timestamp: new Date().toISOString(),
			...(data ? { data } : {}),
		}

		const output = pretty ? JSON.stringify(entry, null, 2) : JSON.stringify(entry)

		if (logLevel === 'error') {
			console.error(output)
		} else if (logLevel === 'warn') {
			console.warn(output)
		} else {
			console.log(output)
		}
	}

	return {
		debug: (msg, data) => log('debug', msg, data),
		info: (msg, data) => log('info', msg, data),
		warn: (msg, data) => log('warn', msg, data),
		error: (msg, data) => log('error', msg, data),
		child(childContext) {
			return createLogger({
				level,
				pretty,
				context: { ...context, ...childContext },
			})
		},
	}
}
