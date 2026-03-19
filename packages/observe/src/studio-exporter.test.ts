import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SpanData } from './span'
import { createStudioExporter } from './studio-exporter'
import type { CostReport } from './tracer'

describe('StudioExporter', () => {
	let testDir: string

	beforeEach(() => {
		testDir = join(tmpdir(), `studio-exporter-test-${Date.now()}`)
		mkdirSync(testDir, { recursive: true })
	})

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true })
	})

	it('creates traces directory on init', () => {
		createStudioExporter({ dir: testDir })
		expect(existsSync(join(testDir, 'traces'))).toBe(true)
	})

	it('exports spans as individual trace files', () => {
		const exporter = createStudioExporter({ dir: testDir })

		const span: SpanData = {
			id: 'span_1',
			traceId: 'trc_abc',
			name: 'test-span',
			kind: 'llm',
			status: 'ok',
			startTime: Date.now(),
			endTime: Date.now() + 100,
			durationMs: 100,
			metadata: { model: 'gpt-4o' },
			events: [],
		}

		exporter.export([span])

		const filePath = join(testDir, 'traces', 'trc_abc.json')
		expect(existsSync(filePath)).toBe(true)

		const written = JSON.parse(readFileSync(filePath, 'utf-8'))
		expect(written.traceId).toBe('trc_abc')
		expect(written.name).toBe('test-span')
	})

	it('writes xray entries with most recent first', () => {
		const exporter = createStudioExporter({ dir: testDir })

		exporter.writeXRayEntry({ traceId: 'trc_1', provider: 'anthropic' })
		exporter.writeXRayEntry({ traceId: 'trc_2', provider: 'openai' })

		const xrayPath = join(testDir, 'xray-history.json')
		const history = JSON.parse(readFileSync(xrayPath, 'utf-8'))
		expect(history).toHaveLength(2)
		expect(history[0].traceId).toBe('trc_2')
		expect(history[1].traceId).toBe('trc_1')
	})

	it('writes cost report in studio format', () => {
		const exporter = createStudioExporter({ dir: testDir })

		const report: CostReport = {
			totalCost: 5.42,
			totalTokens: 100000,
			totalInputTokens: 70000,
			totalOutputTokens: 30000,
			callCount: 25,
			byModel: {
				'gpt-4o': { cost: 3.0, tokens: 60000, calls: 15 },
				'claude-sonnet-4-6': { cost: 2.42, tokens: 40000, calls: 10 },
			},
		}

		exporter.writeCostReport(report)

		const costPath = join(testDir, 'cost-report.json')
		const written = JSON.parse(readFileSync(costPath, 'utf-8'))
		expect(written.totalRequests).toBe(25)
		expect(written.totalTokens).toBe(100000)
		expect(written.totalCost).toBe(5.42)
		expect(written.byModel['gpt-4o'].requests).toBe(15)
		expect(written.byModel['claude-sonnet-4-6'].cost).toBe(2.42)
	})

	it('caps xray history at 500 entries', () => {
		const exporter = createStudioExporter({ dir: testDir })

		for (let i = 0; i < 510; i++) {
			exporter.writeXRayEntry({ traceId: `trc_${i}` })
		}

		const xrayPath = join(testDir, 'xray-history.json')
		const history = JSON.parse(readFileSync(xrayPath, 'utf-8'))
		expect(history).toHaveLength(500)
		expect(history[0].traceId).toBe('trc_509')
	})
})
