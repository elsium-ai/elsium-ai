import { describe, expect, it } from 'vitest'
import { type AgentTrace, createTraceRecorder, replayFrom } from './replay-from'

function fixedClock(values: number[]): () => number {
	let i = 0
	return () => values[Math.min(i++, values.length - 1)]
}

function buildTrace(): AgentTrace {
	const rec = createTraceRecorder({
		traceId: 'tr_1',
		agentId: 'invoice-extractor',
		clock: fixedClock([1000, 1100, 1200, 1300, 1400]),
	})
	rec.recordStep({ key: 'classify', input: 'raw text', output: 'invoice', durationMs: 50 })
	rec.recordStep({ key: 'extract', input: 'invoice raw', output: { total: 100 }, durationMs: 80 })
	rec.recordStep({ key: 'validate', input: { total: 100 }, output: { ok: true }, durationMs: 20 })
	return rec.finish()
}

describe('createTraceRecorder', () => {
	it('records steps in order with metadata preserved', () => {
		const rec = createTraceRecorder({ traceId: 'x' })
		rec.recordStep({ key: 'a', input: 1, output: 2, metadata: { tag: 'first' } })
		rec.recordStep({ key: 'b', input: 2, output: 4 })
		const trace = rec.finish()
		expect(trace.id).toBe('x')
		expect(trace.steps).toHaveLength(2)
		expect(trace.steps[0].metadata).toEqual({ tag: 'first' })
		expect(trace.steps[1].output).toBe(4)
	})

	it('finish() captures startedAt/endedAt from the injected clock', () => {
		const rec = createTraceRecorder({ traceId: 'x', clock: fixedClock([10, 20, 30]) })
		rec.recordStep({ key: 'a', input: 1, output: 2 })
		const trace = rec.finish()
		expect(trace.startedAt).toBe(10)
		expect(trace.endedAt).toBe(30)
	})
})

describe('replayFrom — full replay', () => {
	it('replays every step from 0 by simply re-feeding recorded outputs', async () => {
		const trace = buildTrace()
		let executorCalls = 0
		const result = await replayFrom(trace, {
			fromStep: trace.steps.length,
			executor: async () => {
				executorCalls++
				return null as never
			},
		})
		expect(executorCalls).toBe(0)
		expect(result.steps.every((s) => s.source === 'replay')).toBe(true)
		expect(result.finalOutput).toEqual({ ok: true })
	})
})

describe('replayFrom — partial replay with live tail', () => {
	it('re-feeds steps before fromStep and runs executor live from fromStep onward', async () => {
		const trace = buildTrace()
		const seenLive: string[] = []
		const result = await replayFrom(trace, {
			fromStep: 1,
			executor: async ({ key }) => {
				seenLive.push(key)
				return key === 'extract' ? { total: 999 } : { ok: false }
			},
		})
		expect(seenLive).toEqual(['extract', 'validate'])
		expect(result.steps[0].source).toBe('replay')
		expect(result.steps[1].source).toBe('live')
		expect(result.steps[2].source).toBe('live')
		expect((result.steps[1].output as { total: number }).total).toBe(999)
		expect(result.finalOutput).toEqual({ ok: false })
	})

	it('accepts fromStep as a key string', async () => {
		const trace = buildTrace()
		const result = await replayFrom(trace, {
			fromStep: 'validate',
			executor: async () => ({ ok: 'forced' }),
		})
		expect(result.steps.map((s) => s.source)).toEqual(['replay', 'replay', 'live'])
		expect(result.finalOutput).toEqual({ ok: 'forced' })
	})
})

describe('replayFrom — overrides', () => {
	it('replace override skips the executor entirely', async () => {
		const trace = buildTrace()
		let calls = 0
		const result = await replayFrom(trace, {
			fromStep: 0,
			executor: async () => {
				calls++
				return null as never
			},
			overrides: {
				classify: { kind: 'replace', output: 'OVERRIDE' },
				extract: { kind: 'replace', output: { total: 1 } },
				validate: { kind: 'replace', output: { ok: 'forced' } },
			},
		})
		expect(calls).toBe(0)
		expect(result.steps.every((s) => s.overridden)).toBe(true)
		expect(result.finalOutput).toEqual({ ok: 'forced' })
	})

	it('transform.input rewrites the input passed to the executor', async () => {
		const trace = buildTrace()
		const seenInputs: unknown[] = []
		await replayFrom(trace, {
			fromStep: 0,
			executor: async ({ input }) => {
				seenInputs.push(input)
				return 'ok'
			},
			overrides: {
				classify: { kind: 'transform', input: (raw) => `${raw} [transformed]` },
			},
		})
		expect(seenInputs[0]).toBe('raw text [transformed]')
		expect(seenInputs[1]).toBe('invoice raw')
	})

	it('transform.output post-processes executor output', async () => {
		const trace = buildTrace()
		const result = await replayFrom(trace, {
			fromStep: 0,
			executor: async () => ({ score: 1 }),
			overrides: {
				extract: { kind: 'transform', output: (out) => ({ ...(out as object), tagged: true }) },
			},
		})
		expect(result.steps[1].output).toEqual({ score: 1, tagged: true })
	})
})

describe('replayFrom — validation', () => {
	it('throws when fromStep is a negative number', async () => {
		const trace = buildTrace()
		await expect(
			replayFrom(trace, { fromStep: -1, executor: async () => null as never }),
		).rejects.toThrow(/out of range/)
	})

	it('throws when fromStep is a string that does not match any key', async () => {
		const trace = buildTrace()
		await expect(
			replayFrom(trace, { fromStep: 'missing', executor: async () => null as never }),
		).rejects.toThrow(/not found in trace/)
	})

	it('throws when fromStep is beyond trace length', async () => {
		const trace = buildTrace()
		await expect(
			replayFrom(trace, { fromStep: 99, executor: async () => null as never }),
		).rejects.toThrow(/out of range/)
	})
})
