import { existsSync, readFileSync, readdirSync, watch } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { getStudioHTML } from './studio-ui'

const ELSIUM_DIR = '.elsium'
const TRACES_DIR = '.elsium/traces'
const XRAY_FILE = '.elsium/xray-history.json'
const COST_FILE = '.elsium/cost-report.json'

function readJsonSafe(filePath: string, fallback: unknown = null): unknown {
	try {
		if (!existsSync(filePath)) return fallback
		return JSON.parse(readFileSync(filePath, 'utf-8'))
	} catch {
		return fallback
	}
}

function readTraces(cwd: string): unknown[] {
	const tracesPath = join(cwd, TRACES_DIR)
	if (!existsSync(tracesPath)) return []

	try {
		const files = readdirSync(tracesPath)
			.filter((f) => f.endsWith('.json'))
			.sort()
			.reverse()
			.slice(0, 100)

		return files.map((f) => readJsonSafe(join(tracesPath, f), [])).filter(Boolean)
	} catch {
		return []
	}
}

type SSEClient = ServerResponse

export function createStudioServer(port: number, cwd?: string) {
	const root = cwd ?? process.cwd()
	const clients: Set<SSEClient> = new Set()

	function broadcast(data: Record<string, unknown>) {
		const payload = `data: ${JSON.stringify(data)}\n\n`
		for (const client of clients) {
			try {
				client.write(payload)
			} catch {
				clients.delete(client)
			}
		}
	}

	const elsiumPath = join(root, ELSIUM_DIR)
	let watcher: ReturnType<typeof watch> | null = null

	if (existsSync(elsiumPath)) {
		try {
			watcher = watch(elsiumPath, { recursive: true }, (_event, filename) => {
				if (filename) {
					broadcast({ type: inferEventType(String(filename)), file: String(filename) })
				}
			})
		} catch {
			// fs.watch may not be available
		}
	}

	function inferEventType(filename: string): string {
		if (filename.includes('traces')) return 'trace'
		if (filename.includes('xray')) return 'xray'
		if (filename.includes('cost')) return 'cost'
		return 'update'
	}

	const server = createServer((req: IncomingMessage, res: ServerResponse) => {
		const url = req.url ?? '/'

		if (url === '/') {
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
			res.end(getStudioHTML())
			return
		}

		if (url === '/api/traces') {
			res.writeHead(200, {
				'Content-Type': 'application/json',
				'Cache-Control': 'no-cache',
			})
			res.end(JSON.stringify(readTraces(root)))
			return
		}

		if (url === '/api/xray') {
			res.writeHead(200, {
				'Content-Type': 'application/json',
				'Cache-Control': 'no-cache',
			})
			res.end(JSON.stringify(readJsonSafe(join(root, XRAY_FILE), [])))
			return
		}

		if (url === '/api/cost') {
			res.writeHead(200, {
				'Content-Type': 'application/json',
				'Cache-Control': 'no-cache',
			})
			res.end(JSON.stringify(readJsonSafe(join(root, COST_FILE), {})))
			return
		}

		if (url === '/api/events') {
			res.writeHead(200, {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
			})
			res.write('data: {"type":"connected"}\n\n')
			clients.add(res)
			req.on('close', () => {
				clients.delete(res)
			})
			return
		}

		res.writeHead(404, { 'Content-Type': 'text/plain' })
		res.end('Not Found')
	})

	const cleanup = () => {
		if (watcher) {
			watcher.close()
			watcher = null
		}
		for (const client of clients) {
			try {
				client.end()
			} catch {
				// ignore
			}
		}
		clients.clear()
	}

	server.on('close', cleanup)

	return server
}

export async function studioCommand(args: string[]) {
	let port = 4567

	const portIdx = args.indexOf('--port')
	if (portIdx !== -1 && args[portIdx + 1]) {
		const parsed = Number.parseInt(args[portIdx + 1], 10)
		if (!Number.isNaN(parsed) && parsed > 0 && parsed < 65536) {
			port = parsed
		}
	}

	if (args.includes('--help') || args.includes('-h')) {
		console.log(`
  ElsiumAI Studio — Local Dev Dashboard

  Usage:
    elsium studio                Start on default port (4567)
    elsium studio --port 8080    Start on custom port

  The dashboard shows live traces, costs, and request history
  from the .elsium/ directory in the current project.
`)
		return
	}

	const server = createStudioServer(port)

	server.listen(port, () => {
		console.log(`
  ElsiumAI Studio is running

  Dashboard:  http://localhost:${port}
  API:        http://localhost:${port}/api/traces
              http://localhost:${port}/api/xray
              http://localhost:${port}/api/cost
              http://localhost:${port}/api/events (SSE)

  Press Ctrl+C to stop
`)
	})

	process.on('SIGINT', () => {
		server.close()
		process.exit(0)
	})

	process.on('SIGTERM', () => {
		server.close()
		process.exit(0)
	})
}
