import { describe, expect, it } from 'vitest'
import {
	type GenAIMapper,
	createEmissionPolicy,
	createGenAIConventionRegistry,
	getDefaultRegistry,
	parseSemconvOptIn,
	resetDefaultRegistry,
} from './gen-ai-conventions'
import type { SpanData } from './span'

function makeSpan(overrides: Partial<SpanData> = {}): SpanData {
	return {
		id: 'spn_1',
		traceId: 'trc_1',
		name: 'test-span',
		kind: 'llm',
		status: 'ok',
		startTime: 1_700_000_000_000,
		endTime: 1_700_000_001_000,
		durationMs: 1000,
		metadata: {},
		events: [],
		...overrides,
	}
}

describe('parseSemconvOptIn', () => {
	it('returns empty set on undefined or empty string', () => {
		expect(parseSemconvOptIn(undefined).size).toBe(0)
		expect(parseSemconvOptIn('').size).toBe(0)
	})

	it('parses a single flag', () => {
		const set = parseSemconvOptIn('gen_ai_latest_experimental')
		expect(set.has('gen_ai_latest_experimental')).toBe(true)
		expect(set.size).toBe(1)
	})

	it('parses CSV with whitespace and skips empty entries', () => {
		const set = parseSemconvOptIn('http, gen_ai_latest_experimental ,, http/dup')
		expect(set.size).toBe(3)
		expect(set.has('gen_ai_latest_experimental')).toBe(true)
		expect(set.has('http')).toBe(true)
		expect(set.has('http/dup')).toBe(true)
	})
})

describe('createEmissionPolicy', () => {
	it('default (no env, no explicit): legacy yes, GenAI no', () => {
		const policy = createEmissionPolicy({ env: {} })
		expect(policy.shouldEmitLegacy()).toBe(true)
		expect(policy.shouldEmitGenAI()).toBe(false)
		expect(policy.resolvedFromEnv().source).toBe('env')
		expect(policy.resolvedFromEnv().optIn.size).toBe(0)
	})

	it('env opt-in flips emission', () => {
		const policy = createEmissionPolicy({
			env: { OTEL_SEMCONV_STABILITY_OPT_IN: 'gen_ai_latest_experimental' },
		})
		expect(policy.shouldEmitLegacy()).toBe(false)
		expect(policy.shouldEmitGenAI()).toBe(true)
	})

	it('explicit opt-in array takes precedence over env', () => {
		const policy = createEmissionPolicy({
			optIn: ['gen_ai_latest_experimental'],
			env: { OTEL_SEMCONV_STABILITY_OPT_IN: '' },
		})
		expect(policy.shouldEmitGenAI()).toBe(true)
		expect(policy.resolvedFromEnv().source).toBe('explicit')
	})

	it('explicit empty opt-in disables GenAI even if env would enable', () => {
		const policy = createEmissionPolicy({
			optIn: [],
			env: { OTEL_SEMCONV_STABILITY_OPT_IN: 'gen_ai_latest_experimental' },
		})
		expect(policy.shouldEmitGenAI()).toBe(false)
		expect(policy.shouldEmitLegacy()).toBe(true)
	})

	it('handles CSV with other flags without breaking', () => {
		const policy = createEmissionPolicy({
			env: { OTEL_SEMCONV_STABILITY_OPT_IN: 'http,gen_ai_latest_experimental,http/dup' },
		})
		expect(policy.shouldEmitGenAI()).toBe(true)
		expect(policy.resolvedFromEnv().optIn.size).toBe(3)
	})
})

describe('built-in mappers — LLM span', () => {
	const registry = getDefaultRegistry()
	const mapper = registry.getMapper('llm')

	it('exists for span kind llm', () => {
		expect(mapper).not.toBeNull()
		expect(mapper?.specVersion).toBe('v1.36')
	})

	it('returns null when provider or model is missing', () => {
		expect(mapper?.map(makeSpan({ metadata: {} }))).toBeNull()
		expect(mapper?.map(makeSpan({ metadata: { provider: 'anthropic' } }))).toBeNull()
		expect(mapper?.map(makeSpan({ metadata: { model: 'claude-sonnet-4-6' } }))).toBeNull()
	})

	it('maps minimal request attributes', () => {
		const attrs = mapper?.map(
			makeSpan({
				kind: 'llm',
				metadata: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
			}),
		)
		expect(attrs).toEqual({
			'gen_ai.system': 'anthropic',
			'gen_ai.operation.name': 'chat',
			'gen_ai.request.model': 'claude-sonnet-4-6',
		})
	})

	it('honors explicit operationName when set', () => {
		const attrs = mapper?.map(
			makeSpan({
				metadata: {
					provider: 'openai',
					model: 'text-embedding-3-small',
					operationName: 'embeddings',
				},
			}),
		)
		expect(attrs).toMatchObject({ 'gen_ai.operation.name': 'embeddings' })
	})

	it('maps request hyperparameters when present', () => {
		const attrs = mapper?.map(
			makeSpan({
				metadata: {
					provider: 'anthropic',
					model: 'claude-sonnet-4-6',
					maxTokens: 1024,
					temperature: 0.7,
					topP: 0.95,
					topK: 40,
				},
			}),
		)
		expect(attrs).toMatchObject({
			'gen_ai.request.max_tokens': 1024,
			'gen_ai.request.temperature': 0.7,
			'gen_ai.request.top_p': 0.95,
			'gen_ai.request.top_k': 40,
		})
	})

	it('maps response and usage attributes when present', () => {
		const attrs = mapper?.map(
			makeSpan({
				metadata: {
					provider: 'anthropic',
					model: 'claude-sonnet-4-6',
					responseModel: 'claude-sonnet-4-6-20251201',
					responseId: 'msg_abc',
					finishReasons: ['stop'],
					inputTokens: 100,
					outputTokens: 50,
				},
			}),
		)
		expect(attrs).toMatchObject({
			'gen_ai.response.model': 'claude-sonnet-4-6-20251201',
			'gen_ai.response.id': 'msg_abc',
			'gen_ai.response.finish_reasons': ['stop'],
			'gen_ai.usage.input_tokens': 100,
			'gen_ai.usage.output_tokens': 50,
		})
	})

	it('accepts finishReason singular as array of one', () => {
		const attrs = mapper?.map(
			makeSpan({
				metadata: {
					provider: 'openai',
					model: 'gpt-5',
					finishReason: 'length',
				},
			}),
		)
		expect(attrs).toMatchObject({ 'gen_ai.response.finish_reasons': ['length'] })
	})

	it('ignores invalid metadata types (defensive)', () => {
		const attrs = mapper?.map(
			makeSpan({
				metadata: {
					provider: 'anthropic',
					model: 'claude-sonnet-4-6',
					temperature: 'not-a-number',
					inputTokens: null,
					finishReasons: [1, 2, 3],
				},
			}),
		)
		expect(attrs).not.toHaveProperty('gen_ai.request.temperature')
		expect(attrs).not.toHaveProperty('gen_ai.usage.input_tokens')
		expect(attrs).not.toHaveProperty('gen_ai.response.finish_reasons')
	})
})

describe('built-in mappers — Tool span', () => {
	const mapper = getDefaultRegistry().getMapper('tool')

	it('exists', () => {
		expect(mapper).not.toBeNull()
	})

	it('maps tool name (falls back to span.name)', () => {
		const attrs = mapper?.map(makeSpan({ kind: 'tool', name: 'weather-tool', metadata: {} }))
		expect(attrs).toMatchObject({
			'gen_ai.tool.name': 'weather-tool',
			'gen_ai.operation.name': 'tool.execute',
		})
	})

	it('prefers explicit toolName over span.name', () => {
		const attrs = mapper?.map(
			makeSpan({ kind: 'tool', name: 'span-name', metadata: { toolName: 'real-tool' } }),
		)
		expect(attrs).toMatchObject({ 'gen_ai.tool.name': 'real-tool' })
	})

	it('maps tool call id when present', () => {
		const attrs = mapper?.map(
			makeSpan({ kind: 'tool', metadata: { toolName: 'x', toolCallId: 'call_abc' } }),
		)
		expect(attrs).toMatchObject({ 'gen_ai.tool.call.id': 'call_abc' })
	})

	it('accepts only valid tool types', () => {
		const attrs = mapper?.map(
			makeSpan({ kind: 'tool', metadata: { toolName: 'x', toolType: 'function' } }),
		)
		expect(attrs).toMatchObject({ 'gen_ai.tool.type': 'function' })

		const attrsInvalid = mapper?.map(
			makeSpan({ kind: 'tool', metadata: { toolName: 'x', toolType: 'weird' } }),
		)
		expect(attrsInvalid).not.toHaveProperty('gen_ai.tool.type')
	})
})

describe('built-in mappers — Agent span', () => {
	const mapper = getDefaultRegistry().getMapper('agent')

	it('maps agent invocation with provider/model fallback', () => {
		const attrs = mapper?.map(makeSpan({ kind: 'agent', name: 'support-agent', metadata: {} }))
		expect(attrs).toMatchObject({
			'gen_ai.system': 'elsium',
			'gen_ai.operation.name': 'agent.invoke',
			'gen_ai.request.model': 'support-agent',
		})
	})

	it('maps usage when present', () => {
		const attrs = mapper?.map(
			makeSpan({
				kind: 'agent',
				name: 'support',
				metadata: { inputTokens: 200, outputTokens: 100 },
			}),
		)
		expect(attrs).toMatchObject({
			'gen_ai.usage.input_tokens': 200,
			'gen_ai.usage.output_tokens': 100,
		})
	})
})

describe('GenAIConventionRegistry', () => {
	it('registers and retrieves mappers by kind and version', () => {
		const reg = createGenAIConventionRegistry('v1.36')
		const v136: GenAIMapper<'llm'> = {
			kind: 'llm',
			specVersion: 'v1.36',
			map: () => ({
				'gen_ai.system': 'a',
				'gen_ai.operation.name': 'chat',
				'gen_ai.request.model': 'm',
			}),
		}
		const v137: GenAIMapper<'llm'> = {
			kind: 'llm',
			specVersion: 'v1.37',
			map: () => ({
				'gen_ai.system': 'b',
				'gen_ai.operation.name': 'chat',
				'gen_ai.request.model': 'm',
			}),
		}
		reg.register(v136)
		reg.register(v137)

		expect(reg.getMapper('llm', 'v1.36')).toBe(v136)
		expect(reg.getMapper('llm', 'v1.37')).toBe(v137)
		expect(reg.getMapper('llm')).toBe(v136) // default version
		expect(reg.getMapper('custom')).toBeNull()
	})

	it('listVersions enumerates all registered versions', () => {
		const reg = createGenAIConventionRegistry()
		reg.register({ kind: 'llm', specVersion: 'v1.36', map: () => null })
		reg.register({ kind: 'tool', specVersion: 'v1.36', map: () => null })
		reg.register({ kind: 'llm', specVersion: 'v1.37', map: () => null })

		const versions = reg.listVersions()
		expect(versions).toContain('v1.36')
		expect(versions).toContain('v1.37')
		expect(versions.length).toBe(2)
	})

	it('defaultVersion is settable', () => {
		const reg = createGenAIConventionRegistry('v1.36')
		expect(reg.defaultVersion).toBe('v1.36')
		reg.defaultVersion = 'v1.37'
		expect(reg.defaultVersion).toBe('v1.37')
	})
})

describe('getDefaultRegistry singleton', () => {
	it('returns the same instance across calls', () => {
		resetDefaultRegistry()
		const a = getDefaultRegistry()
		const b = getDefaultRegistry()
		expect(a).toBe(b)
	})

	it('ships built-in mappers for llm, tool, agent on v1.36', () => {
		resetDefaultRegistry()
		const reg = getDefaultRegistry()
		expect(reg.getMapper('llm', 'v1.36')).not.toBeNull()
		expect(reg.getMapper('tool', 'v1.36')).not.toBeNull()
		expect(reg.getMapper('agent', 'v1.36')).not.toBeNull()
		expect(reg.getMapper('workflow', 'v1.36')).toBeNull()
		expect(reg.getMapper('custom', 'v1.36')).toBeNull()
	})
})

describe('property: every llm span with provider+model gets the three required GenAI attrs', () => {
	const mapper = getDefaultRegistry().getMapper('llm')

	it('holds for varied metadata shapes', () => {
		const cases = [
			{ provider: 'anthropic', model: 'claude-sonnet-4-6' },
			{ provider: 'openai', model: 'gpt-5', temperature: 0 },
			{ provider: 'google', model: 'gemini-2.5-pro', topK: 1, inputTokens: 0, outputTokens: 0 },
			{ provider: 'x', model: 'y', operationName: 'text_completion' },
		]
		for (const meta of cases) {
			const attrs = mapper?.map(makeSpan({ metadata: meta }))
			expect(attrs).not.toBeNull()
			if (!attrs) continue
			expect(attrs).toHaveProperty('gen_ai.system')
			expect(attrs).toHaveProperty('gen_ai.operation.name')
			expect(attrs).toHaveProperty('gen_ai.request.model')
		}
	})
})
