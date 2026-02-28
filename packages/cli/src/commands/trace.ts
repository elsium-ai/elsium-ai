import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const TRACES_DIR = '.elsium/traces'

interface SpanData {
	id: string
	traceId: string
	parentId?: string
	name: string
	kind: string
	status: string
	startTime: number
	endTime?: number
	durationMs?: number
	metadata: Record<string, unknown>
	events: Array<{ name: string; timestamp: number; data?: Record<string, unknown> }>
}

export async function traceCommand(args: string[]) {
	const traceId = args[0]
	const tracesPath = join(process.cwd(), TRACES_DIR)

	if (!traceId) {
		// List recent traces
		if (!existsSync(tracesPath)) {
			console.log(`
  No traces found.

  Traces are recorded when you run your app with tracing enabled:

    const app = createApp({
      observe: {
        tracing: true,
      },
    })

  Usage:
    elsium trace           List recent traces
    elsium trace <id>      Inspect a specific trace
`)
			return
		}

		try {
			const files = readdirSync(tracesPath)
				.filter((f) => f.endsWith('.json'))
				.sort()
				.reverse()
				.slice(0, 20)

			if (files.length === 0) {
				console.log('\n  No traces recorded yet.\n')
				return
			}

			console.log(`\n  Recent Traces (${files.length})`)
			console.log(`  ${'─'.repeat(60)}`)

			for (const file of files) {
				const data = JSON.parse(readFileSync(join(tracesPath, file), 'utf-8')) as SpanData[]

				const root = data.find((s) => !s.parentId) ?? data[0]
				if (root) {
					const status = root.status === 'ok' ? 'OK' : root.status === 'error' ? 'ERR' : '...'
					const duration = root.durationMs ? `${root.durationMs}ms` : '?'
					console.log(`  [${status}] ${root.traceId}  ${root.name}  ${duration}`)
				}
			}

			console.log()
		} catch (err) {
			console.error('Failed to read traces:', err instanceof Error ? err.message : err)
		}

		return
	}

	// H8 fix: Validate traceId to prevent path traversal
	if (!/^[a-zA-Z0-9_-]+$/.test(traceId)) {
		console.error('Invalid trace ID format')
		process.exit(1)
	}

	// Show specific trace
	const traceFile = join(tracesPath, `${traceId}.json`)

	if (!existsSync(traceFile)) {
		console.error(`Trace not found: ${traceId}`)
		process.exit(1)
	}

	try {
		const spans = JSON.parse(readFileSync(traceFile, 'utf-8')) as SpanData[]

		console.log(`\n  Trace: ${traceId}`)
		console.log(`  Spans: ${spans.length}`)
		console.log(`  ${'─'.repeat(60)}`)

		// Build tree
		const roots = spans.filter((s) => !s.parentId)
		for (const root of roots) {
			printSpanTree(root, spans, 0)
		}

		console.log()
	} catch (err) {
		console.error('Failed to read trace:', err instanceof Error ? err.message : err)
		process.exit(1)
	}
}

function printSpanTree(span: SpanData, allSpans: SpanData[], depth: number) {
	const indent = `  ${'  '.repeat(depth)}`
	const status = span.status === 'ok' ? 'OK' : span.status === 'error' ? 'ERR' : '...'
	const duration = span.durationMs ? `${span.durationMs}ms` : ''
	const kind = span.kind ? `[${span.kind}]` : ''

	console.log(`${indent}${kind} ${span.name} (${status}) ${duration}`)

	// Print metadata
	for (const [key, value] of Object.entries(span.metadata)) {
		console.log(`${indent}  ${key}: ${JSON.stringify(value)}`)
	}

	// Print events
	for (const event of span.events) {
		console.log(`${indent}  > ${event.name}${event.data ? `: ${JSON.stringify(event.data)}` : ''}`)
	}

	// Print children
	const children = allSpans.filter((s) => s.parentId === span.id)
	for (const child of children) {
		printSpanTree(child, allSpans, depth + 1)
	}
}
