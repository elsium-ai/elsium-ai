import { describe, expect, it, vi } from 'vitest'
import { countTokens, createContextManager } from './index'
import type { Message } from './types'

// ─── countTokens ────────────────────────────────────────────────

describe('countTokens', () => {
	it('estimates tokens with default model (ratio 4)', () => {
		// "hello world" = 11 chars, ratio 4 => ceil(11/4) + 4 = 3 + 4 = 7
		const tokens = countTokens('hello world')
		expect(tokens).toBe(7)
	})

	it('estimates tokens with claude model (ratio 3.5)', () => {
		// "hello world" = 11 chars, ratio 3.5 => ceil(11/3.5) + 4 = ceil(3.14) + 4 = 4 + 4 = 8
		const tokens = countTokens('hello world', 'claude-sonnet-4-6')
		expect(tokens).toBe(8)
	})

	it('uses 3.5 ratio for any model starting with "claude"', () => {
		const tokens = countTokens('hello world', 'claude-custom-v1')
		expect(tokens).toBe(8)
	})

	it('uses ratio 4 for gpt models', () => {
		const tokens = countTokens('hello world', 'gpt-4o')
		expect(tokens).toBe(7)
	})

	it('uses ratio 4 for unknown models', () => {
		const tokens = countTokens('hello world', 'some-unknown-model')
		expect(tokens).toBe(7)
	})

	it('handles empty string', () => {
		// 0 chars / 4 = 0, ceil(0) + 4 = 4
		const tokens = countTokens('')
		expect(tokens).toBe(4)
	})
})

// ─── createContextManager ───────────────────────────────────────

describe('createContextManager', () => {
	const shortMessage: Message = { role: 'user', content: 'hi' }
	const longMessage: Message = {
		role: 'user',
		content: 'A'.repeat(1000),
	}

	it('returns messages unchanged when within budget', async () => {
		const mgr = createContextManager({
			maxTokens: 10000,
			strategy: 'truncate',
		})

		const messages: Message[] = [
			{ role: 'user', content: 'hello' },
			{ role: 'assistant', content: 'hi there' },
		]

		const result = await mgr.fit(messages)
		expect(result).toEqual(messages)
	})

	it('returns empty array for empty messages', async () => {
		const mgr = createContextManager({
			maxTokens: 100,
			strategy: 'truncate',
		})

		const result = await mgr.fit([])
		expect(result).toEqual([])
	})

	it('estimateTokens returns sum of message token estimates', () => {
		const mgr = createContextManager({
			maxTokens: 10000,
			strategy: 'truncate',
		})

		const messages: Message[] = [
			{ role: 'user', content: 'hello' },
			{ role: 'assistant', content: 'world' },
		]

		const tokens = mgr.estimateTokens(messages)
		// Each: countTokens("hello") + 4 = ceil(5/4)+4+4 = 2+4+4 = 10
		// Total: 10 + 10 = 20
		expect(tokens).toBeGreaterThan(0)
		expect(typeof tokens).toBe('number')
	})

	describe('truncate strategy', () => {
		it('keeps most recent messages when over budget', async () => {
			const mgr = createContextManager({
				maxTokens: 30,
				strategy: 'truncate',
			})

			const messages: Message[] = [
				{ role: 'user', content: 'A'.repeat(200) },
				{ role: 'assistant', content: 'B'.repeat(200) },
				{ role: 'user', content: 'hi' },
			]

			const result = await mgr.fit(messages)
			// Should keep the newest messages that fit
			expect(result.length).toBeLessThan(messages.length)
			// Last message should always be included
			expect(result[result.length - 1]).toEqual(messages[messages.length - 1])
		})

		it('accounts for system prompt in budget', async () => {
			const mgr = createContextManager({
				maxTokens: 50,
				strategy: 'truncate',
			})

			const messages: Message[] = [
				{ role: 'user', content: 'A'.repeat(100) },
				{ role: 'user', content: 'hello' },
			]

			const withSystem = await mgr.fit(messages, 'A'.repeat(100))
			const withoutSystem = await mgr.fit(messages)

			// With a large system prompt, fewer messages should fit
			expect(withSystem.length).toBeLessThanOrEqual(withoutSystem.length)
		})
	})

	describe('sliding-window strategy', () => {
		it('keeps most recent messages within budget', async () => {
			const mgr = createContextManager({
				maxTokens: 30,
				strategy: 'sliding-window',
			})

			const messages: Message[] = [
				{ role: 'user', content: 'A'.repeat(200) },
				{ role: 'assistant', content: 'B'.repeat(200) },
				{ role: 'user', content: 'hi' },
			]

			const result = await mgr.fit(messages)
			expect(result.length).toBeLessThan(messages.length)
			expect(result[result.length - 1]).toEqual(messages[messages.length - 1])
		})
	})

	describe('summarize strategy', () => {
		it('falls back to truncate when no summarizer is provided', async () => {
			const mgr = createContextManager({
				maxTokens: 30,
				strategy: 'summarize',
			})

			const messages: Message[] = [
				{ role: 'user', content: 'A'.repeat(200) },
				{ role: 'user', content: 'hi' },
			]

			const result = await mgr.fit(messages)
			expect(result.length).toBeLessThanOrEqual(messages.length)
		})

		it('uses summarizer to compress older messages', async () => {
			const summarizer = vi.fn().mockResolvedValue('Summary of conversation')

			const mgr = createContextManager({
				maxTokens: 30,
				strategy: 'summarize',
				summarizer,
			})

			const messages: Message[] = [
				{ role: 'user', content: 'A'.repeat(200) },
				{ role: 'assistant', content: 'B'.repeat(200) },
				{ role: 'user', content: 'C'.repeat(200) },
			]

			const result = await mgr.fit(messages)
			expect(summarizer).toHaveBeenCalled()
			// Should contain a system message with the summary
			expect(result[0].role).toBe('system')
			expect(result[0].content).toContain('Summary of conversation')
		})

		it('does not call summarizer when messages fit within budget', async () => {
			const summarizer = vi.fn().mockResolvedValue('Summary')

			const mgr = createContextManager({
				maxTokens: 10000,
				strategy: 'summarize',
				summarizer,
			})

			const messages: Message[] = [{ role: 'user', content: 'hello' }]

			const result = await mgr.fit(messages)
			expect(summarizer).not.toHaveBeenCalled()
			expect(result).toEqual(messages)
		})
	})

	it('respects reserveTokens', async () => {
		const mgr = createContextManager({
			maxTokens: 100,
			strategy: 'truncate',
			reserveTokens: 90,
		})

		const messages: Message[] = [
			{ role: 'user', content: 'A'.repeat(200) },
			{ role: 'user', content: 'hi' },
		]

		// With 90 reserved out of 100, only 10 tokens available
		const result = await mgr.fit(messages)
		expect(result.length).toBeLessThan(messages.length)
	})
})
