import type { AuditEvent } from './audit'
import type { AuditSink } from './audit-sink'

export interface SplunkSinkConfig {
	url: string
	token: string
	index?: string
	source?: string
	sourcetype?: string
	timeoutMs?: number
}

function toSplunkEvent(
	event: AuditEvent,
	index?: string,
	source?: string,
	sourcetype?: string,
): string {
	return JSON.stringify({
		time: event.timestamp / 1000,
		source: source ?? 'elsium-ai',
		sourcetype: sourcetype ?? 'elsium:audit',
		...(index && { index }),
		event,
	})
}

export function createSplunkSink(config: SplunkSinkConfig): AuditSink {
	const { url, token, index, source, sourcetype, timeoutMs = 10_000 } = config

	return {
		name: 'splunk',

		async send(events: AuditEvent[]): Promise<void> {
			const body = events.map((e) => toSplunkEvent(e, index, source, sourcetype)).join('\n')

			const controller = new AbortController()
			const timeout = setTimeout(() => controller.abort(), timeoutMs)

			try {
				const response = await fetch(url, {
					method: 'POST',
					headers: {
						Authorization: `Splunk ${token}`,
						'Content-Type': 'application/json',
					},
					body,
					signal: controller.signal,
				})

				if (!response.ok) {
					throw new Error(`Splunk HEC responded with ${response.status} ${response.statusText}`)
				}
			} catch (error) {
				if (error instanceof DOMException && error.name === 'AbortError') {
					throw new Error(`Splunk HEC request timed out after ${timeoutMs}ms`)
				}
				throw error
			} finally {
				clearTimeout(timeout)
			}
		},
	}
}
