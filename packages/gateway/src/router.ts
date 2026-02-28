import type { CompletionRequest, LLMResponse, ProviderConfig } from '@elsium-ai/core'
import {
	type CircuitBreaker,
	type CircuitBreakerConfig,
	ElsiumError,
	type ElsiumStream,
	createCircuitBreaker,
} from '@elsium-ai/core'
import { gateway } from './gateway'
import type { Gateway } from './gateway'
import { calculateCost } from './pricing'

export type RoutingStrategy =
	| 'fallback'
	| 'cost-optimized'
	| 'latency-optimized'
	| 'capability-aware'

export interface ProviderEntry {
	name: string
	config: { apiKey: string; baseUrl?: string }
	model?: string
	priority?: number
	capabilities?: string[]
}

export interface CostOptimizerConfig {
	simpleModel: { provider: string; model: string }
	complexModel: { provider: string; model: string }
	complexityThreshold?: number
}

export interface ProviderMeshConfig {
	providers: ProviderEntry[]
	strategy: RoutingStrategy
	costOptimizer?: CostOptimizerConfig
	circuitBreaker?: CircuitBreakerConfig | boolean
}

export interface ProviderMesh {
	complete(request: CompletionRequest): Promise<LLMResponse>
	stream(request: CompletionRequest): ElsiumStream
	readonly providers: string[]
	readonly strategy: RoutingStrategy
}

const REASONING_KEYWORDS =
	/\b(prove|explain why|analyze|compare|contrast|evaluate|critique|debate|reason|deduce|infer|justify|argue|synthesize|hypothesize|derive)\b/i

const CODE_KEYWORDS =
	/\b(implement|refactor|debug|optimize|architect|design pattern|algorithm|data structure|write code|code review|fix the bug|type system)\b/i

const CREATIVE_KEYWORDS =
	/\b(write a (story|essay|poem|article|report|paper)|compose|draft|create a (plan|proposal|strategy))\b/i

const MATH_KEYWORDS =
	/\b(calculate|compute|solve|equation|integral|derivative|matrix|probability|statistical|proof|theorem|formula)\b/i

function extractTextContent(request: CompletionRequest): string {
	const parts: string[] = []
	for (const m of request.messages) {
		if (typeof m.content === 'string') {
			parts.push(m.content)
		} else if (Array.isArray(m.content)) {
			for (const p of m.content) {
				if (p.type === 'text') parts.push(p.text)
			}
		}
	}
	if (request.system) parts.push(request.system)
	return parts.join(' ')
}

function estimateComplexity(request: CompletionRequest): number {
	let score = 0
	const totalChars = request.messages.reduce((sum, m) => {
		const len = typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length
		return sum + len
	}, 0)

	if (totalChars > 2000) score += 0.3
	if (totalChars > 5000) score += 0.2
	if (request.tools?.length) score += 0.2
	if ((request.tools?.length ?? 0) > 3) score += 0.1
	if (request.system && request.system.length > 500) score += 0.1
	if (request.messages.length > 10) score += 0.1

	const text = extractTextContent(request)
	if (REASONING_KEYWORDS.test(text)) score += 0.5
	if (CODE_KEYWORDS.test(text)) score += 0.5
	if (CREATIVE_KEYWORDS.test(text)) score += 0.2
	if (MATH_KEYWORDS.test(text)) score += 0.5

	return Math.min(score, 1)
}

export function createProviderMesh(config: ProviderMeshConfig): ProviderMesh {
	if (config.providers.length === 0) {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'Provider mesh requires at least one provider',
			retryable: false,
		})
	}

	const sortedProviders = [...config.providers].sort(
		(a, b) => (a.priority ?? 99) - (b.priority ?? 99),
	)

	const gateways = new Map<string, Gateway>()
	const circuitBreakers = new Map<string, CircuitBreaker>()

	for (const entry of sortedProviders) {
		const gw = gateway({
			provider: entry.name,
			apiKey: entry.config.apiKey,
			baseUrl: entry.config.baseUrl,
			model: entry.model,
		})
		gateways.set(entry.name, gw)

		if (config.circuitBreaker) {
			const cbConfig = typeof config.circuitBreaker === 'boolean' ? {} : config.circuitBreaker
			circuitBreakers.set(entry.name, createCircuitBreaker(cbConfig))
		}
	}

	function callWithCircuitBreaker<T>(providerName: string, fn: () => Promise<T>): Promise<T> {
		const cb = circuitBreakers.get(providerName)
		return cb ? cb.execute(fn) : fn()
	}

	function isProviderAvailable(providerName: string): boolean {
		const cb = circuitBreakers.get(providerName)
		return !cb || cb.state !== 'open'
	}

	function getGateway(providerName: string): Gateway {
		const gw = gateways.get(providerName)
		if (!gw) {
			throw new ElsiumError({
				code: 'CONFIG_ERROR',
				message: `Provider "${providerName}" not found in mesh`,
				retryable: false,
			})
		}
		return gw
	}

	async function fallbackComplete(request: CompletionRequest): Promise<LLMResponse> {
		let lastError: Error | null = null

		for (const entry of sortedProviders) {
			if (!isProviderAvailable(entry.name)) continue

			try {
				const gw = getGateway(entry.name)
				return await callWithCircuitBreaker(entry.name, () =>
					gw.complete({ ...request, model: request.model ?? entry.model }),
				)
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err))
			}
		}

		throw (
			lastError ??
			new ElsiumError({
				code: 'PROVIDER_ERROR',
				message: 'All providers failed',
				retryable: false,
			})
		)
	}

	async function costOptimizedComplete(request: CompletionRequest): Promise<LLMResponse> {
		const optimizer = config.costOptimizer
		if (!optimizer) {
			return fallbackComplete(request)
		}

		const complexity = estimateComplexity(request)
		const threshold = optimizer.complexityThreshold ?? 0.5

		const target = complexity < threshold ? optimizer.simpleModel : optimizer.complexModel
		const gw = getGateway(target.provider)

		try {
			return await gw.complete({ ...request, model: target.model })
		} catch {
			return fallbackComplete(request)
		}
	}

	// H1 fix: Cancel remaining requests when first one succeeds
	async function latencyOptimizedComplete(request: CompletionRequest): Promise<LLMResponse> {
		const controller = new AbortController()
		const availableProviders = sortedProviders.filter((e) => isProviderAvailable(e.name))

		const promises = availableProviders.map(async (entry) => {
			const gw = getGateway(entry.name)
			return callWithCircuitBreaker(entry.name, () =>
				gw.complete({
					...request,
					model: request.model ?? entry.model,
					signal: controller.signal,
				}),
			)
		})

		try {
			const result = await Promise.any(promises)
			controller.abort() // Cancel remaining in-flight requests
			return result
		} catch {
			throw new ElsiumError({
				code: 'PROVIDER_ERROR',
				message: 'All providers failed',
				retryable: false,
			})
		}
	}

	function detectRequiredCapabilities(request: CompletionRequest): string[] {
		const capabilities: string[] = []
		if ((request.tools?.length ?? 0) > 0) capabilities.push('tools')

		const needsVision = request.messages.some(
			(m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image'),
		)
		if (needsVision) capabilities.push('vision')

		return capabilities
	}

	function filterCapableProviders(capabilities: string[]): ProviderEntry[] {
		return sortedProviders.filter((entry) => {
			if (capabilities.length === 0) return true
			const providerCaps = entry.capabilities ?? defaultCapabilities(entry.name)
			return capabilities.every((c) => providerCaps.includes(c))
		})
	}

	async function tryProviders(
		providers: ProviderEntry[],
		request: CompletionRequest,
	): Promise<LLMResponse> {
		let lastError: Error | null = null

		for (const entry of providers) {
			if (!isProviderAvailable(entry.name)) continue

			try {
				const gw = getGateway(entry.name)
				return await callWithCircuitBreaker(entry.name, () =>
					gw.complete({ ...request, model: request.model ?? entry.model }),
				)
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err))
			}
		}

		throw (
			lastError ??
			new ElsiumError({
				code: 'PROVIDER_ERROR',
				message: 'No capable provider succeeded',
				retryable: false,
			})
		)
	}

	async function capabilityAwareComplete(request: CompletionRequest): Promise<LLMResponse> {
		const capabilities = detectRequiredCapabilities(request)
		const capable = filterCapableProviders(capabilities)

		if (capable.length === 0) {
			return fallbackComplete(request)
		}

		return tryProviders(capable, request)
	}

	function defaultCapabilities(provider: string): string[] {
		switch (provider) {
			case 'anthropic':
				return ['tools', 'vision', 'streaming', 'system']
			case 'openai':
				return ['tools', 'vision', 'streaming', 'system', 'json_mode']
			case 'google':
				return ['tools', 'vision', 'streaming', 'system']
			default:
				return ['streaming']
		}
	}

	return {
		providers: sortedProviders.map((p) => p.name),
		strategy: config.strategy,

		async complete(request: CompletionRequest): Promise<LLMResponse> {
			switch (config.strategy) {
				case 'fallback':
					return fallbackComplete(request)
				case 'cost-optimized':
					return costOptimizedComplete(request)
				case 'latency-optimized':
					return latencyOptimizedComplete(request)
				case 'capability-aware':
					return capabilityAwareComplete(request)
				default:
					return fallbackComplete(request)
			}
		},

		stream(request: CompletionRequest): ElsiumStream {
			const entry = sortedProviders[0]
			const gw = getGateway(entry.name)
			return gw.stream({ ...request, model: request.model ?? entry.model })
		},
	}
}
