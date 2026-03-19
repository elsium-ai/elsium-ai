import type { AuditEvent } from './audit'
import type { AuditSink } from './audit-sink'

export interface WebhookSinkConfig {
	url: string
	headers?: Record<string, string>
	method?: 'POST' | 'PUT'
	timeoutMs?: number
}

export function createWebhookSink(config: WebhookSinkConfig): AuditSink {
	const { url, headers = {}, method = 'POST', timeoutMs = 10_000 } = config

	return {
		name: 'webhook',

		async send(events: AuditEvent[]): Promise<void> {
			const controller = new AbortController()
			const timeout = setTimeout(() => controller.abort(), timeoutMs)

			try {
				const response = await fetch(url, {
					method,
					headers: {
						'Content-Type': 'application/json',
						...headers,
					},
					body: JSON.stringify({ events }),
					signal: controller.signal,
				})

				if (!response.ok) {
					throw new Error(`Webhook responded with ${response.status} ${response.statusText}`)
				}
			} catch (error) {
				if (error instanceof DOMException && error.name === 'AbortError') {
					throw new Error(`Webhook request timed out after ${timeoutMs}ms`)
				}
				throw error
			} finally {
				clearTimeout(timeout)
			}
		},
	}
}
