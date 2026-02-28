import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const XRAY_FILE = '.elsium/xray-history.json'

interface XRayEntry {
	traceId: string
	timestamp: number
	provider: string
	model: string
	latencyMs: number
	request: {
		url: string
		method: string
		headers: Record<string, string>
		body: Record<string, unknown>
	}
	response: {
		status: number
		headers: Record<string, string>
		body: Record<string, unknown>
	}
	usage: { inputTokens: number; outputTokens: number; totalTokens: number }
	cost: { inputCost: number; outputCost: number; totalCost: number; currency: string }
}

export async function xrayCommand(args: string[]) {
	const flag = args[0]

	if (flag === '--help' || flag === '-h') {
		console.log(`
  ElsiumAI X-Ray — Inspect LLM calls

  Usage:
    elsium xray                Show last call
    elsium xray --last N       Show last N calls
    elsium xray --trace <id>   Show call by trace ID
    elsium xray --raw          Show raw request/response

  X-Ray data is captured when xray mode is enabled:

    const gw = gateway({ ..., xray: true })
`)
		return
	}

	const xrayPath = join(process.cwd(), XRAY_FILE)

	if (!existsSync(xrayPath)) {
		console.log(`
  No X-Ray data found.

  Enable X-Ray mode on your gateway to capture LLM call details:

    const gw = gateway({ provider: 'anthropic', apiKey: '...', xray: true })
    await gw.complete({ messages: [...] })
    console.log(gw.lastCall())

  X-Ray data will be saved to .elsium/xray-history.json
`)
		return
	}

	try {
		const entries: XRayEntry[] = JSON.parse(readFileSync(xrayPath, 'utf-8'))

		if (flag === '--trace') {
			const traceId = args[1]
			if (!traceId) {
				console.error('  Please provide a trace ID: elsium xray --trace <id>')
				process.exit(1)
			}
			const entry = entries.find((e) => e.traceId === traceId)
			if (!entry) {
				console.error(`  Trace not found: ${traceId}`)
				process.exit(1)
			}
			printEntry(entry, args.includes('--raw'))
			return
		}

		const count = flag === '--last' ? Number.parseInt(args[1] ?? '5', 10) : 1
		const showRaw = args.includes('--raw')
		const toShow = entries.slice(0, count)

		if (toShow.length === 0) {
			console.log('\n  No X-Ray data recorded yet.\n')
			return
		}

		console.log(`\n  ElsiumAI X-Ray — ${toShow.length} call(s)`)
		console.log(`  ${'─'.repeat(60)}`)

		for (const entry of toShow) {
			printEntry(entry, showRaw)
		}
	} catch (err) {
		console.error('Failed to read X-Ray data:', err instanceof Error ? err.message : err)
		process.exit(1)
	}
}

function printEntry(entry: XRayEntry, raw = false) {
	console.log(`
  Trace:    ${entry.traceId}
  Time:     ${new Date(entry.timestamp).toISOString()}
  Provider: ${entry.provider}
  Model:    ${entry.model}
  Latency:  ${entry.latencyMs}ms
  Tokens:   ${entry.usage.inputTokens} in / ${entry.usage.outputTokens} out (${entry.usage.totalTokens} total)
  Cost:     $${entry.cost.totalCost.toFixed(6)}`)

	if (raw) {
		console.log(`
  ── Request ──
  ${entry.request.method} ${entry.request.url}
  Headers: ${JSON.stringify(entry.request.headers, null, 4)}
  Body: ${JSON.stringify(entry.request.body, null, 4)}

  ── Response ──
  Status: ${entry.response.status}
  Headers: ${JSON.stringify(entry.response.headers, null, 4)}
  Body: ${JSON.stringify(entry.response.body, null, 4)}`)
	}

	console.log(`  ${'─'.repeat(60)}`)
}
