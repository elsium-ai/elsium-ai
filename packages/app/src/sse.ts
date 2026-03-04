import type { ElsiumStream, StreamEvent } from '@elsium-ai/core'
import type { Context } from 'hono'
import { stream } from 'hono/streaming'

export function sseHeaders(): Record<string, string> {
	return {
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache',
		Connection: 'keep-alive',
		'X-Accel-Buffering': 'no',
	}
}

export function formatSSE(event: string, data: unknown): string {
	const json = JSON.stringify(data)
	if (event === 'message') {
		return `data: ${json}\n\n`
	}
	return `event: ${event}\ndata: ${json}\n\n`
}

export function streamResponse(c: Context, source: ElsiumStream): Response {
	const headers = sseHeaders()
	for (const [key, value] of Object.entries(headers)) {
		c.header(key, value)
	}

	return stream(c, async (s) => {
		try {
			for await (const event of source) {
				const sseData = formatSSE('message', event)
				await s.write(sseData)
			}
		} catch (err) {
			const errorEvent: StreamEvent = {
				type: 'error',
				error: err instanceof Error ? err : new Error(String(err)),
			}
			const sseData = formatSSE('error', {
				type: 'error',
				message: errorEvent.error.message,
			})
			await s.write(sseData)
		}
	})
}
