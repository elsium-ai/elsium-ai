import type { LLMResponse, MiddlewareContext } from '@elsium-ai/core'
import { createFlowPolicy, createFlowTracker } from '@elsium-ai/core'
import { describe, expect, it, vi } from 'vitest'
import { flowMiddleware } from './flow-middleware'

function ctx(messages: Array<{ role: string; content: unknown }>, provider = 'anthropic') {
	return {
		request: { messages },
		provider,
		model: 'test-model',
		traceId: 'trc_1',
		startTime: 0,
		metadata: {},
	} as unknown as MiddlewareContext
}

const response = { message: { role: 'assistant', content: 'ok' } } as unknown as LLMResponse
const next = async () => response

describe('flowMiddleware', () => {
	it('labels messages by role — user content is data, not instructions', async () => {
		const policy = createFlowPolicy([
			{ name: 'no-untrusted', sink: 'llm:*', deny: { origin: ['untrusted'] } },
		])
		const tracker = createFlowTracker({ policy })
		const mw = flowMiddleware({ tracker })

		await expect(
			mw(ctx([{ role: 'system', content: 'You are helpful.' }]), next),
		).resolves.toBeDefined()

		tracker.reset()
		await expect(mw(ctx([{ role: 'user', content: 'hello' }]), next)).rejects.toThrow(/Flow denied/)
	})

	it('checks against the provider sink so jurisdiction rules work', async () => {
		const policy = createFlowPolicy([
			{ name: 'eu-only', sink: 'llm:openai', deny: { hasClasses: ['pii:eu'] } },
		])
		const tracker = createFlowTracker({ policy })
		const mw = flowMiddleware({
			tracker,
			classify: ({ text }) => (text.includes('@') ? { classes: ['pii:eu'] } : undefined),
		})

		await expect(
			mw(ctx([{ role: 'user', content: 'contact a@b.eu' }], 'openai'), next),
		).rejects.toThrow(/Flow denied/)

		tracker.reset()
		await expect(
			mw(ctx([{ role: 'user', content: 'contact a@b.eu' }], 'mistral-eu'), next),
		).resolves.toBeDefined()
	})

	it('extracts text from multimodal content parts', async () => {
		const policy = createFlowPolicy([
			{ name: 'no-secrets', sink: 'llm:*', deny: { hasAnyClass: ['secret'] } },
		])
		const tracker = createFlowTracker({ policy })
		const mw = flowMiddleware({
			tracker,
			classify: ({ text }) => (text.includes('sk-live') ? { classes: ['secret'] } : undefined),
		})

		await expect(
			mw(
				ctx([
					{
						role: 'user',
						content: [
							{ type: 'text', text: 'here is ' },
							{ type: 'text', text: 'sk-live-123' },
						],
					},
				]),
				next,
			),
		).rejects.toThrow(/Flow denied/)
	})

	it('marks model output as model-origin, not trusted', async () => {
		const policy = createFlowPolicy([
			{ name: 'never', sink: 'nothing:*', deny: { origin: ['untrusted'] } },
		])
		const tracker = createFlowTracker({ policy })

		await flowMiddleware({ tracker })(ctx([{ role: 'system', content: 'hi' }]), next)

		expect(tracker.label.origin).toBe('model')
		expect(tracker.label.sources).toContain('llm:anthropic')
	})

	it('defers to onDeny instead of throwing when provided', async () => {
		const policy = createFlowPolicy([
			{ name: 'no-untrusted', sink: 'llm:*', deny: { origin: ['untrusted'] } },
		])
		const tracker = createFlowTracker({ policy })
		const onDeny = vi.fn()

		await expect(
			flowMiddleware({ tracker, onDeny })(ctx([{ role: 'user', content: 'hi' }]), next),
		).resolves.toBeDefined()
		expect(onDeny).toHaveBeenCalledTimes(1)
	})

	it('lets a classifier override the role default', async () => {
		const policy = createFlowPolicy([
			{ name: 'no-untrusted', sink: 'llm:*', deny: { origin: ['untrusted'] } },
		])
		const tracker = createFlowTracker({ policy })

		await expect(
			flowMiddleware({
				tracker,
				classify: () => ({ origin: 'trusted' as const }),
			})(ctx([{ role: 'user', content: 'hi' }]), next),
		).resolves.toBeDefined()
	})
})
