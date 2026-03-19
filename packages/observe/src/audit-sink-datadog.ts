import type { AuditEvent } from './audit'
import type { AuditSink } from './audit-sink'

export interface DatadogSinkConfig {
	apiKey: string
	site?: string
	service?: string
	source?: string
	tags?: Record<string, string>
	timeoutMs?: number
}

function formatTags(tags: Record<string, string>): string {
	return Object.entries(tags)
		.map(([k, v]) => `${k}:${v}`)
		.join(',')
}

function toDatadogLog(
	event: AuditEvent,
	service: string,
	source: string,
	tags?: Record<string, string>,
): Record<string, unknown> {
	return {
		ddsource: source,
		ddtags: tags ? formatTags(tags) : undefined,
		service,
		hostname: 'elsium-ai',
		message: `[${event.type}] ${JSON.stringify(event.data)}`,
		status: event.type === 'security_violation' ? 'error' : 'info',
		timestamp: event.timestamp,
		audit: {
			id: event.id,
			sequenceId: event.sequenceId,
			type: event.type,
			actor: event.actor,
			traceId: event.traceId,
			data: event.data,
			hash: event.hash,
			previousHash: event.previousHash,
		},
	}
}

export function createDatadogSink(config: DatadogSinkConfig): AuditSink {
	const {
		apiKey,
		site = 'datadoghq.com',
		service = 'elsium-ai',
		source = 'elsium-ai-audit',
		tags,
		timeoutMs = 10_000,
	} = config

	const endpoint = `https://http-intake.logs.${site}/api/v2/logs`

	return {
		name: 'datadog',

		async send(events: AuditEvent[]): Promise<void> {
			const body = events.map((e) => toDatadogLog(e, service, source, tags))

			const controller = new AbortController()
			const timeout = setTimeout(() => controller.abort(), timeoutMs)

			try {
				const response = await fetch(endpoint, {
					method: 'POST',
					headers: {
						'DD-API-KEY': apiKey,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify(body),
					signal: controller.signal,
				})

				if (!response.ok) {
					throw new Error(
						`Datadog Log Intake responded with ${response.status} ${response.statusText}`,
					)
				}
			} catch (error) {
				if (error instanceof DOMException && error.name === 'AbortError') {
					throw new Error(`Datadog request timed out after ${timeoutMs}ms`)
				}
				throw error
			} finally {
				clearTimeout(timeout)
			}
		},
	}
}
