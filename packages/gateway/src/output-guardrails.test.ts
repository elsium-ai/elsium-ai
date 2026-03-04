import type { LLMResponse, MiddlewareContext } from '@elsium-ai/core'
import { ElsiumError } from '@elsium-ai/core'
import { describe, expect, it, vi } from 'vitest'
import { outputGuardrailMiddleware } from './output-guardrails'

// ─── Helpers ────────────────────────────────────────────────────

function createMockContext(): MiddlewareContext {
	return {
		request: {
			messages: [{ role: 'user', content: 'hello' }],
		},
		provider: 'test',
		model: 'test-model',
		traceId: 'trc_test',
		startTime: performance.now(),
		metadata: {},
	}
}

function createMockResponse(content: string): LLMResponse {
	return {
		id: 'test-id',
		message: { role: 'assistant', content },
		usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
		cost: { inputCost: 0.001, outputCost: 0.001, totalCost: 0.002, currency: 'USD' },
		model: 'test-model',
		provider: 'test',
		stopReason: 'end_turn',
		latencyMs: 100,
		traceId: 'trc_test',
	}
}

function createNext(content: string) {
	return vi.fn().mockResolvedValue(createMockResponse(content))
}

// ─── PII Detection ──────────────────────────────────────────────

describe('outputGuardrailMiddleware — PII detection', () => {
	it('detects email addresses', async () => {
		const mw = outputGuardrailMiddleware({
			piiDetection: true,
			onViolation: 'block',
		})

		const ctx = createMockContext()
		const next = createNext('Contact me at john@example.com')

		await expect(mw(ctx, next)).rejects.toThrow(ElsiumError)
		await expect(mw(ctx, next)).rejects.toThrow(/email/)
	})

	it('detects phone numbers', async () => {
		const mw = outputGuardrailMiddleware({
			piiDetection: true,
			onViolation: 'block',
		})

		const ctx = createMockContext()
		const next = createNext('Call me at (555) 123-4567')

		await expect(mw(ctx, next)).rejects.toThrow(ElsiumError)
	})

	it('detects SSN patterns', async () => {
		const mw = outputGuardrailMiddleware({
			piiDetection: true,
			onViolation: 'block',
		})

		const ctx = createMockContext()
		const next = createNext('SSN: 123-45-6789')

		await expect(mw(ctx, next)).rejects.toThrow(ElsiumError)
		await expect(mw(ctx, next)).rejects.toThrow(/ssn/)
	})

	it('passes through clean content', async () => {
		const mw = outputGuardrailMiddleware({
			piiDetection: true,
			onViolation: 'block',
		})

		const ctx = createMockContext()
		const next = createNext('Here is the weather forecast for today.')

		const result = await mw(ctx, next)
		expect(result.message.content).toBe('Here is the weather forecast for today.')
	})
})

// ─── Content Policy ─────────────────────────────────────────────

describe('outputGuardrailMiddleware — content policy', () => {
	it('blocks responses exceeding max length', async () => {
		const mw = outputGuardrailMiddleware({
			contentPolicy: { maxResponseLength: 10 },
			onViolation: 'block',
		})

		const ctx = createMockContext()
		const next = createNext('This response is way too long for the limit')

		await expect(mw(ctx, next)).rejects.toThrow(ElsiumError)
		await expect(mw(ctx, next)).rejects.toThrow(/exceeds max/)
	})

	it('allows responses within max length', async () => {
		const mw = outputGuardrailMiddleware({
			contentPolicy: { maxResponseLength: 1000 },
			onViolation: 'block',
		})

		const ctx = createMockContext()
		const next = createNext('Short response')

		const result = await mw(ctx, next)
		expect(result.message.content).toBe('Short response')
	})

	it('blocks responses matching blocked patterns', async () => {
		const mw = outputGuardrailMiddleware({
			contentPolicy: { blockedPatterns: [/forbidden/i] },
			onViolation: 'block',
		})

		const ctx = createMockContext()
		const next = createNext('This is FORBIDDEN content')

		await expect(mw(ctx, next)).rejects.toThrow(ElsiumError)
		await expect(mw(ctx, next)).rejects.toThrow(/blocked pattern/)
	})
})

// ─── Custom Rules ───────────────────────────────────────────────

describe('outputGuardrailMiddleware — custom rules', () => {
	it('detects violations from custom rules', async () => {
		const mw = outputGuardrailMiddleware({
			customRules: [
				{
					name: 'no-profanity',
					pattern: /badword/i,
					message: 'Profanity detected',
				},
			],
			onViolation: 'block',
		})

		const ctx = createMockContext()
		const next = createNext('This contains a badword in it')

		await expect(mw(ctx, next)).rejects.toThrow(ElsiumError)
		await expect(mw(ctx, next)).rejects.toThrow(/Profanity detected/)
	})

	it('passes clean content through custom rules', async () => {
		const mw = outputGuardrailMiddleware({
			customRules: [
				{
					name: 'no-profanity',
					pattern: /badword/i,
				},
			],
			onViolation: 'block',
		})

		const ctx = createMockContext()
		const next = createNext('This is perfectly clean content')

		const result = await mw(ctx, next)
		expect(result.message.content).toBe('This is perfectly clean content')
	})
})

// ─── Violation Modes ────────────────────────────────────────────

describe('outputGuardrailMiddleware — violation modes', () => {
	it('block mode throws ElsiumError with VALIDATION_ERROR code', async () => {
		const mw = outputGuardrailMiddleware({
			piiDetection: true,
			onViolation: 'block',
		})

		const ctx = createMockContext()
		const next = createNext('Email: test@example.com')

		try {
			await mw(ctx, next)
			expect.fail('Should have thrown')
		} catch (error) {
			expect(error).toBeInstanceOf(ElsiumError)
			expect((error as ElsiumError).code).toBe('VALIDATION_ERROR')
		}
	})

	it('redact mode replaces PII in response', async () => {
		const mw = outputGuardrailMiddleware({
			piiDetection: true,
			onViolation: 'redact',
		})

		const ctx = createMockContext()
		const next = createNext('Email me at john@example.com or call 555-123-4567')

		const result = await mw(ctx, next)
		const text = result.message.content as string

		expect(text).toContain('[REDACTED_EMAIL]')
		expect(text).toContain('[REDACTED_PHONE]')
		expect(text).not.toContain('john@example.com')
		expect(text).not.toContain('555-123-4567')
	})

	it('warn mode returns unmodified response', async () => {
		const mw = outputGuardrailMiddleware({
			piiDetection: true,
			onViolation: 'warn',
		})

		const ctx = createMockContext()
		const originalContent = 'Email me at john@example.com'
		const next = createNext(originalContent)

		const result = await mw(ctx, next)
		expect(result.message.content).toBe(originalContent)
	})

	it('calls onViolationCallback for each violation', async () => {
		const callback = vi.fn()
		const mw = outputGuardrailMiddleware({
			piiDetection: true,
			onViolation: 'warn',
			onViolationCallback: callback,
		})

		const ctx = createMockContext()
		const next = createNext('Email: test@example.com, SSN: 123-45-6789')

		await mw(ctx, next)

		expect(callback).toHaveBeenCalled()
		// Should be called for both email and SSN violations
		expect(callback.mock.calls.length).toBeGreaterThanOrEqual(2)
	})

	it('defaults to block mode when onViolation is not set', async () => {
		const mw = outputGuardrailMiddleware({
			piiDetection: true,
		})

		const ctx = createMockContext()
		const next = createNext('Email: test@example.com')

		await expect(mw(ctx, next)).rejects.toThrow(ElsiumError)
	})
})
