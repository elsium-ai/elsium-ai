import type { StreamEvent } from '@elsium-ai/core'

export async function* parseSSEStream(response: Response): AsyncIterable<StreamEvent> {
	if (!response.body) {
		throw new Error('Response body is null')
	}

	const reader = response.body.getReader()
	const decoder = new TextDecoder()
	let buffer = ''

	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break

			buffer += decoder.decode(value, { stream: true })
			const lines = buffer.split('\n')
			buffer = lines.pop() ?? ''

			for (const line of lines) {
				if (line.startsWith('event: error')) {
					// Next data line will be the error
					continue
				}
				if (!line.startsWith('data: ')) continue
				const data = line.slice(6).trim()
				if (!data || data === '[DONE]') continue

				try {
					const event = JSON.parse(data) as StreamEvent
					yield event
				} catch {
					// Skip malformed events
				}
			}
		}
	} finally {
		reader.releaseLock()
	}
}
