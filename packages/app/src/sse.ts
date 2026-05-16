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
