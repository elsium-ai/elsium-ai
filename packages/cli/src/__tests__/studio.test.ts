import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createStudioServer } from '../commands/studio'
import { getStudioHTML } from '../commands/studio-ui'

function getRandomPort(): number {
	return 10000 + Math.floor(Math.random() * 50000)
}

async function fetchJSON(url: string): Promise<unknown> {
	const res = await fetch(url)
	return res.json()
}

describe('Studio UI', () => {
	it('should return a valid HTML string', () => {
		const html = getStudioHTML()
		expect(html).toContain('<!DOCTYPE html>')
		expect(html).toContain('<html')
		expect(html).toContain('</html>')
		expect(html).toContain('ElsiumAI Studio')
	})

	it('should contain all four tabs', () => {
		const html = getStudioHTML()
		expect(html).toContain('data-tab="traces"')
		expect(html).toContain('data-tab="xray"')
		expect(html).toContain('data-tab="costs"')
		expect(html).toContain('data-tab="live"')
	})

	it('should contain SSE connection logic', () => {
		const html = getStudioHTML()
		expect(html).toContain('EventSource')
		expect(html).toContain('/api/events')
	})

	it('should use dark theme colors', () => {
		const html = getStudioHTML()
		expect(html).toContain('#1e1e2e')
		expect(html).toContain('#cdd6f4')
		expect(html).toContain('#89b4fa')
	})
})

describe('Studio Server', () => {
	let server: Server
	let port: number
	let testDir: string

	beforeEach(() => {
		testDir = join(tmpdir(), `elsium-studio-test-${Date.now()}`)
		mkdirSync(testDir, { recursive: true })
		port = getRandomPort()
		server = createStudioServer(port, testDir)
	})

	afterEach(async () => {
		server.closeAllConnections()
		await new Promise<void>((resolve) => {
			server.close(() => resolve())
		})
		rmSync(testDir, { recursive: true, force: true })
	})

	function startServer(): Promise<void> {
		return new Promise((resolve) => {
			server.listen(port, () => resolve())
		})
	}

	it('should serve HTML on GET /', async () => {
		await startServer()
		const res = await fetch(`http://localhost:${port}/`)
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toContain('text/html')
		const body = await res.text()
		expect(body).toContain('ElsiumAI Studio')
	})

	it('should return empty traces when no data exists', async () => {
		await startServer()
		const data = await fetchJSON(`http://localhost:${port}/api/traces`)
		expect(data).toEqual([])
	})

	it('should return traces from .elsium/traces/', async () => {
		const tracesDir = join(testDir, '.elsium/traces')
		mkdirSync(tracesDir, { recursive: true })
		writeFileSync(
			join(tracesDir, 'trc_001.json'),
			JSON.stringify([
				{
					id: 'span_1',
					traceId: 'trc_001',
					name: 'test.span',
					kind: 'llm',
					status: 'ok',
					startTime: Date.now(),
					endTime: Date.now() + 100,
					durationMs: 100,
					metadata: {},
					events: [],
				},
			]),
		)

		await startServer()
		const data = (await fetchJSON(`http://localhost:${port}/api/traces`)) as unknown[][]
		expect(data).toHaveLength(1)
		expect(data[0]).toHaveLength(1)
		expect((data[0][0] as Record<string, unknown>).traceId).toBe('trc_001')
	})

	it('should return empty array when no xray data exists', async () => {
		await startServer()
		const data = await fetchJSON(`http://localhost:${port}/api/xray`)
		expect(data).toEqual([])
	})

	it('should return xray data from .elsium/xray-history.json', async () => {
		mkdirSync(join(testDir, '.elsium'), { recursive: true })
		writeFileSync(
			join(testDir, '.elsium/xray-history.json'),
			JSON.stringify([
				{
					traceId: 'trc_x1',
					provider: 'anthropic',
					model: 'claude-sonnet-4-6',
					latencyMs: 200,
					usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
					cost: { totalCost: 0.001 },
				},
			]),
		)

		await startServer()
		const data = (await fetchJSON(`http://localhost:${port}/api/xray`)) as unknown[]
		expect(data).toHaveLength(1)
		expect((data[0] as Record<string, unknown>).provider).toBe('anthropic')
	})

	it('should return empty object when no cost data exists', async () => {
		await startServer()
		const data = await fetchJSON(`http://localhost:${port}/api/cost`)
		expect(data).toEqual({})
	})

	it('should return cost data from .elsium/cost-report.json', async () => {
		mkdirSync(join(testDir, '.elsium'), { recursive: true })
		writeFileSync(
			join(testDir, '.elsium/cost-report.json'),
			JSON.stringify({
				totalCost: 0.05,
				totalTokens: 10000,
				callCount: 3,
				byModel: {
					'claude-sonnet-4-6': { cost: 0.05, tokens: 10000, calls: 3 },
				},
			}),
		)

		await startServer()
		const data = (await fetchJSON(`http://localhost:${port}/api/cost`)) as Record<string, unknown>
		expect(data.totalCost).toBe(0.05)
		expect(data.callCount).toBe(3)
	})

	it('should return 404 for unknown routes', async () => {
		await startServer()
		const res = await fetch(`http://localhost:${port}/unknown`)
		expect(res.status).toBe(404)
	})

	it('should serve SSE endpoint', async () => {
		await startServer()
		const controller = new AbortController()
		const res = await fetch(`http://localhost:${port}/api/events`, {
			signal: controller.signal,
		})
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toBe('text/event-stream')
		controller.abort()
	})
})
