import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'
import { describe, expect, it, vi } from 'vitest'
import type { ReplayEntry } from './replay'
import { applyOverride, replayWithOverride } from './trace-replay-override'

function mkResp(overrides: Partial<LLMResponse> = {}): LLMResponse {
	return {
		id: 'msg',
		message: { role: 'assistant', content: 'baseline' },
		usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
		cost: { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003, currency: 'USD' },
		model: 'gpt-5',
		provider: 'openai',
		stopReason: 'end_turn',
		latencyMs: 200,
		traceId: 't',
		...overrides,
	}
}

function entry(req: CompletionRequest, resp: LLMResponse): ReplayEntry {
	return { request: req, response: resp, timestamp: 0 }
}

describe('applyOverride', () => {
	it('overrides model when set, preserves the rest', () => {
		const req: CompletionRequest = {
			messages: [{ role: 'user', content: 'hi' }],
			model: 'gpt-5',
			temperature: 0.7,
		}
		const out = applyOverride(req, { model: 'claude-haiku-4-5-20251001' })
		expect(out.model).toBe('claude-haiku-4-5-20251001')
		expect(out.temperature).toBe(0.7)
	})

	it('system function transformer receives the original prompt', () => {
		const req: CompletionRequest = {
			messages: [{ role: 'user', content: 'hi' }],
			system: 'Be concise.',
		}
		const out = applyOverride(req, {
			system: (original) => `${original ?? ''} Also be polite.`,
		})
		expect(out.system).toBe('Be concise. Also be polite.')
	})

	it('explicit string system replaces the original', () => {
		const req: CompletionRequest = {
			messages: [{ role: 'user', content: 'hi' }],
			system: 'Old.',
		}
		expect(applyOverride(req, { system: 'New.' }).system).toBe('New.')
	})

	it('preserves request fields not touched by the override', () => {
		const req: CompletionRequest = {
			messages: [{ role: 'user', content: 'hi' }],
			model: 'gpt-5',
			tools: [{ name: 't', description: 'd', inputSchema: {} }],
			seed: 42,
		}
		const out = applyOverride(req, { model: 'other' })
		expect(out.seed).toBe(42)
		expect(out.tools).toHaveLength(1)
	})

	it('topK overrides go to metadata (not on CompletionRequest type)', () => {
		const req: CompletionRequest = { messages: [{ role: 'user', content: 'hi' }] }
		const out = applyOverride(req, { topK: 40 })
		expect(out.metadata?.topK).toBe(40)
	})

	it('topK preserves existing metadata', () => {
		const req: CompletionRequest = {
			messages: [{ role: 'user', content: 'hi' }],
			metadata: { traceId: 'x' },
		}
		const out = applyOverride(req, { topK: 5 })
		expect(out.metadata).toMatchObject({ traceId: 'x', topK: 5 })
	})
})

describe('replayWithOverride', () => {
	const recorded: ReplayEntry[] = [
		entry(
			{ messages: [{ role: 'user', content: 'q1' }], model: 'gpt-5' },
			mkResp({ message: { role: 'assistant', content: 'A1' } }),
		),
		entry(
			{ messages: [{ role: 'user', content: 'q2' }], model: 'gpt-5' },
			mkResp({
				message: { role: 'assistant', content: 'A2' },
				usage: { inputTokens: 80, outputTokens: 60, totalTokens: 140 },
				cost: { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003, currency: 'USD' },
			}),
		),
	]

	it('runs the supplied runner once per entry, with the override applied', async () => {
		const runner = vi.fn(async (req: CompletionRequest) =>
			mkResp({
				model: req.model ?? 'unknown',
				message: { role: 'assistant', content: `from-${req.model}` },
			}),
		)

		const report = await replayWithOverride(
			recorded,
			{ model: 'claude-haiku-4-5-20251001' },
			runner,
		)

		expect(runner).toHaveBeenCalledTimes(2)
		expect(runner.mock.calls[0][0].model).toBe('claude-haiku-4-5-20251001')
		expect(report.entries).toHaveLength(2)
		expect(report.entries[0].overriddenRequest.model).toBe('claude-haiku-4-5-20251001')
	})

	it('reports per-entry deltas and detects content changes', async () => {
		const runner = vi.fn(async () =>
			mkResp({
				message: { role: 'assistant', content: 'DIFFERENT CONTENT' },
				usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
				cost: { inputCost: 0, outputCost: 0, totalCost: 0.001, currency: 'USD' },
				latencyMs: 100,
			}),
		)
		const report = await replayWithOverride(recorded, { model: 'haiku' }, runner)

		const first = report.entries[0]
		expect(first.delta.contentChanged).toBe(true)
		expect(first.delta.totalTokens).toBe(75 - 150)
		expect(first.delta.cost).toBeCloseTo(0.001 - 0.003)
		expect(first.delta.latencyMs).toBe(100 - 200)
	})

	it('aggregates totals and overall delta', async () => {
		const runner = vi.fn(async () =>
			mkResp({
				usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
				cost: { inputCost: 0, outputCost: 0, totalCost: 0.0005, currency: 'USD' },
				latencyMs: 50,
			}),
		)
		const report = await replayWithOverride(recorded, { model: 'cheap' }, runner)

		expect(report.totals.original.tokens).toBe(150 + 140)
		expect(report.totals.current.tokens).toBe(30)
		expect(report.totals.delta.tokens).toBe(30 - 290)
		expect(report.totals.delta.cost).toBeLessThan(0)
	})

	it('contentChanged is false when text-equivalent', async () => {
		const runner = async () => mkResp({ message: { role: 'assistant', content: 'A1' } })
		const single = recorded.slice(0, 1)
		const report = await replayWithOverride(single, {}, runner)
		expect(report.entries[0].delta.contentChanged).toBe(false)
	})

	it('handles multimodal text-parts content by concatenating text segments', async () => {
		const multi: ReplayEntry = {
			request: recorded[0].request,
			response: mkResp({
				message: {
					role: 'assistant',
					content: [
						{ type: 'text', text: 'Hello ' },
						{ type: 'text', text: 'world' },
					],
				},
			}),
			timestamp: 0,
		}
		const runner = async () =>
			mkResp({
				message: {
					role: 'assistant',
					content: [{ type: 'text', text: 'Hello world' }],
				},
			})
		const report = await replayWithOverride([multi], {}, runner)
		expect(report.entries[0].delta.contentChanged).toBe(false)
	})
})
