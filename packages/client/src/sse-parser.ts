import type { StreamEvent } from '@elsium-ai/core'

/** Try to parse a single SSE line into a StreamEvent. Returns undefined if the line should be skipped. */
function parseSSELine(line: string): StreamEvent | undefined {
	if (line.startsWith('event: error')) return undefined
	if (!line.startsWith('data: ')) return undefined

	const data = line.slice(6).trim()
	if (!data || data === '[DONE]') return undefined

	try {
		return JSON.parse(data) as StreamEvent
	} catch {
		// Skip malformed events
		return undefined
	}
}

/** Read chunks from the response body, splitting on newlines and yielding complete lines. */
async function* readSSELines(response: Response): AsyncGenerator<string> {
	const reader = response.body?.getReader()
	if (!reader) return
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
				yield line
			}
		}
	} finally {
		reader.releaseLock()
	}
}

export async function* parseSSEStream(response: Response): AsyncIterable<StreamEvent> {
	if (!response.body) {
		throw new Error('Response body is null')
	}

	for await (const line of readSSELines(response)) {
		const event = parseSSELine(line)
		if (event) yield event
	}
}
