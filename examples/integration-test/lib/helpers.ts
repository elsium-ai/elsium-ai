/**
 * Shared helpers for integration tests.
 *
 * Mock helpers — used by framework tests (no API key needed).
 * Real LLM helpers — used by tests that hit OpenAI (skip gracefully without key).
 */

import type { CompletionRequest, LLMResponse, ProviderConfig } from '@elsium-ai/core'
import type { LLMProvider } from '@elsium-ai/gateway'
import { gateway, registerProviderFactory } from '@elsium-ai/gateway'
import { mockProvider } from '@elsium-ai/testing'
import { describe, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Mock helpers (unchanged — used by framework tests)
// ---------------------------------------------------------------------------

export function registerMockProviderFactory(defaultContent = 'Hello from mock!') {
	registerProviderFactory('mock', (_config: ProviderConfig): LLMProvider => {
		return mockProvider({
			defaultResponse: { content: defaultContent },
		})
	})
}

export function fakeLLMResponse(overrides: Partial<LLMResponse> = {}): LLMResponse {
	return {
		id: 'msg-test-001',
		message: { role: 'assistant', content: 'test response' },
		usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
		cost: { inputCost: 0.001, outputCost: 0.0005, totalCost: 0.0015, currency: 'USD' },
		model: 'mock-model',
		provider: 'mock',
		stopReason: 'end_turn',
		latencyMs: 42,
		traceId: 'trace-test-001',
		...overrides,
	}
}

// ---------------------------------------------------------------------------
// Real LLM helpers (skip when OPENAI_API_KEY is absent)
// ---------------------------------------------------------------------------

export function hasOpenAI(): boolean {
	const key = process.env.OPENAI_API_KEY
	return typeof key === 'string' && key.startsWith('sk-')
}

export const describeWithLLM = hasOpenAI() ? describe : describe.skip

export function createTestGateway(model?: string) {
	const apiKey = process.env.OPENAI_API_KEY as string
	return gateway({
		provider: 'openai',
		apiKey,
		model: model ?? 'gpt-4o-mini',
	})
}

export function createTestComplete(
	model?: string,
): (req: CompletionRequest) => Promise<LLMResponse> {
	const gw = createTestGateway(model)
	return (req) => gw.complete({ ...req, maxTokens: req.maxTokens ?? 50 })
}

// ---------------------------------------------------------------------------
// Real LLM helpers — Anthropic (skip when ANTHROPIC_API_KEY is absent)
// ---------------------------------------------------------------------------

export function hasAnthropic(): boolean {
	const key = process.env.ANTHROPIC_API_KEY
	return typeof key === 'string' && key.length > 0
}

export const describeWithAnthropic = hasAnthropic() ? describe : describe.skip

export function createAnthropicGateway(model?: string) {
	const apiKey = process.env.ANTHROPIC_API_KEY as string
	return gateway({
		provider: 'anthropic',
		apiKey,
		model: model ?? 'claude-haiku-4-5-20251001',
	})
}

export function createAnthropicComplete(
	model?: string,
): (req: CompletionRequest) => Promise<LLMResponse> {
	const gw = createAnthropicGateway(model)
	return (req) => gw.complete({ ...req, maxTokens: req.maxTokens ?? 50 })
}

// ---------------------------------------------------------------------------
// Real LLM helpers — Google (skip when GOOGLE_API_KEY is absent)
// ---------------------------------------------------------------------------

export function hasGoogle(): boolean {
	const key = process.env.GOOGLE_API_KEY
	return typeof key === 'string' && key.length > 0
}

export const describeWithGoogle = hasGoogle() ? describe : describe.skip

export function createGoogleGateway(model?: string) {
	const apiKey = process.env.GOOGLE_API_KEY as string
	return gateway({
		provider: 'google',
		apiKey,
		model: model ?? 'gemini-2.5-flash-lite',
	})
}

export function createGoogleComplete(
	model?: string,
): (req: CompletionRequest) => Promise<LLMResponse> {
	const gw = createGoogleGateway(model)
	return (req) => gw.complete({ ...req, maxTokens: req.maxTokens ?? 50 })
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

export function assertNonEmptyString(value: unknown): asserts value is string {
	expect(typeof value).toBe('string')
	expect((value as string).length).toBeGreaterThan(0)
}

export function assertContainsAny(text: string, keywords: string[]): void {
	const lower = text.toLowerCase()
	const found = keywords.some((kw) => lower.includes(kw.toLowerCase()))
	expect(found).toBe(true)
}
