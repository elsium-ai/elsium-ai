import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'
import {
	type CircuitBreaker,
	type CircuitBreakerConfig,
	ElsiumError,
	ElsiumStream,
	createCircuitBreaker,
	createStream,
} from '@elsium-ai/core'
import { gateway } from './gateway'
import type { Gateway } from './gateway'
import { getProviderMetadata } from './provider'

export type RoutingStrategy =
	| 'fallback'
	| 'cost-optimized'
	| 'latency-optimized'
	| 'capability-aware'

export interface ProviderEntry {
	name: string
	config: { apiKey: string; baseUrl?: string }
	model?: string
	capabilities?: string[]
}

export interface CostOptimizerConfig {
	simpleModel: { provider: string; model: string }
	complexModel: { provider: string; model: string }
	complexityThreshold?: number
}

export interface MeshAuditLogger {
	log(
		type: string,
		data: Record<string, unknown>,
		options?: { actor?: string; traceId?: string },
	): void
}

export interface ProviderMeshConfig {
	providers: ProviderEntry[]
	strategy: RoutingStrategy
	costOptimizer?: CostOptimizerConfig
	circuitBreaker?: CircuitBreakerConfig | boolean
	audit?: MeshAuditLogger
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

	const sortedProviders = [...config.providers]

	const gateways = new Map<string, Gateway>()
	const circuitBreakers = new Map<string, CircuitBreaker>()

	const audit = config.audit

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
			const providerName = entry.name
			const wrappedConfig: CircuitBreakerConfig = {
				...cbConfig,
				onStateChange(from, to) {
					cbConfig.onStateChange?.(from, to)
					audit?.log('circuit_breaker_state_change', {
						provider: providerName,
						fromState: from,
						toState: to,
					})
				},
			}
			circuitBreakers.set(entry.name, createCircuitBreaker(wrappedConfig))
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

	function attemptProvider(entry: ProviderEntry, request: CompletionRequest): Promise<LLMResponse> {
		const gw = getGateway(entry.name)
		return callWithCircuitBreaker(entry.name, () =>
			gw.complete({ ...request, model: request.model ?? entry.model }),
		)
	}

	function logFailover(fromProvider: string, toProvider: string, reason?: string): void {
		audit?.log('provider_failover', {
			fromProvider,
			toProvider,
			strategy: config.strategy,
			reason,
		})
	}

	function toError(err: unknown): Error {
		return err instanceof Error ? err : new Error(String(err))
	}

	async function tryProvidersWithAudit(
		providers: ProviderEntry[],
		request: CompletionRequest,
		errorMessage: string,
	): Promise<LLMResponse> {
		let lastError: Error | null = null
		let failedProvider: string | null = null

		for (const entry of providers) {
			if (!isProviderAvailable(entry.name)) continue

			try {
				const response = await attemptProvider(entry, request)
				if (failedProvider) logFailover(failedProvider, entry.name, lastError?.message)
				return response
			} catch (err) {
				failedProvider = entry.name
				lastError = toError(err)
			}
		}

		throw (
			lastError ??
			new ElsiumError({ code: 'PROVIDER_ERROR', message: errorMessage, retryable: false })
		)
	}

	async function fallbackComplete(request: CompletionRequest): Promise<LLMResponse> {
		return tryProvidersWithAudit(sortedProviders, request, 'All providers failed')
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
		} catch (err) {
			audit?.log('provider_failover', {
				fromProvider: target.provider,
				toProvider: 'fallback-chain',
				strategy: 'cost-optimized',
				reason: err instanceof Error ? err.message : String(err),
			})
			return fallbackComplete(request)
		}
	}

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

	async function capabilityAwareComplete(request: CompletionRequest): Promise<LLMResponse> {
		const capabilities = detectRequiredCapabilities(request)
		const capable = filterCapableProviders(capabilities)

		if (capable.length === 0) {
			return fallbackComplete(request)
		}

		return tryProvidersWithAudit(capable, request, 'No capable provider succeeded')
	}

	function defaultCapabilities(provider: string): string[] {
		// Check provider metadata registry first (supports custom providers)
		const meta = getProviderMetadata(provider)
		if (meta?.capabilities) return meta.capabilities

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

	function errorStream(message: string): ElsiumStream {
		return new ElsiumStream(
			(async function* () {
				yield {
					type: 'error' as const,
					error: new ElsiumError({
						code: 'PROVIDER_ERROR',
						message,
						retryable: false,
					}),
				}
			})(),
		)
	}

	interface StreamAttemptResult {
		success: boolean
		error?: Error
	}

	function logStreamFailover(provider: string, error?: Error): void {
		audit?.log('provider_failover', {
			fromProvider: provider,
			toProvider: 'next',
			strategy: config.strategy,
			reason: error?.message,
		})
	}

	async function tryStreamProvider(
		entry: ProviderEntry,
		request: CompletionRequest,
		emit: (event: import('@elsium-ai/core').StreamEvent) => void,
	): Promise<StreamAttemptResult> {
		const gw = getGateway(entry.name)
		const providerStream = await callWithCircuitBreaker(entry.name, async () =>
			gw.stream({ ...request, model: request.model ?? entry.model }),
		)

		let hasEmittedContent = false

		for await (const event of providerStream) {
			if (event.type === 'error') {
				const err = event.error instanceof Error ? event.error : new Error(String(event.error))
				if (hasEmittedContent) {
					emit(event)
					return { success: true }
				}
				return { success: false, error: err }
			}
			hasEmittedContent = true
			emit(event)
		}

		return { success: true }
	}

	async function runStreamFallbackLoop(
		available: ProviderEntry[],
		request: CompletionRequest,
		emit: (event: import('@elsium-ai/core').StreamEvent) => void,
	): Promise<void> {
		let lastError: Error | null = null
		let failedProvider: string | null = null

		for (const entry of available) {
			try {
				const result = await tryStreamProvider(entry, request, emit)
				if (result.success) {
					if (failedProvider) logFailover(failedProvider, entry.name, lastError?.message)
					return
				}
				lastError = result.error ?? null
				failedProvider = entry.name
				logStreamFailover(entry.name, result.error)
			} catch (err) {
				failedProvider = entry.name
				lastError = toError(err)
				logStreamFailover(entry.name, lastError)
			}
		}

		emit({
			type: 'error',
			error:
				lastError ??
				new ElsiumError({
					code: 'PROVIDER_ERROR',
					message: 'All providers failed during streaming',
					retryable: false,
				}),
		})
	}

	function streamWithFallback(
		providers: ProviderEntry[],
		request: CompletionRequest,
	): ElsiumStream {
		const available = providers.filter((e) => isProviderAvailable(e.name))
		if (available.length === 0) {
			return errorStream('All providers unavailable')
		}

		return createStream(async (emit) => {
			await runStreamFallbackLoop(available, request, emit)
		})
	}

	function streamCostOptimized(request: CompletionRequest): ElsiumStream {
		const optimizer = config.costOptimizer
		if (!optimizer) {
			return streamWithFallback(sortedProviders, request)
		}

		const complexity = estimateComplexity(request)
		const threshold = optimizer.complexityThreshold ?? 0.5
		const target = complexity < threshold ? optimizer.simpleModel : optimizer.complexModel

		return createStream(async (emit) => {
			try {
				const gw = getGateway(target.provider)
				const providerStream = gw.stream({ ...request, model: target.model })
				for await (const event of providerStream) {
					emit(event)
				}
			} catch {
				const fallbackStream = streamWithFallback(sortedProviders, request)
				for await (const event of fallbackStream) {
					emit(event)
				}
			}
		})
	}

	function streamLatencyOptimized(request: CompletionRequest): ElsiumStream {
		const available = sortedProviders.filter((e) => isProviderAvailable(e.name))
		if (available.length === 0) {
			return errorStream('All providers unavailable')
		}

		return createStream(async (emit) => {
			const controller = new AbortController()

			const racePromises = available.map(async (entry) => {
				const gw = getGateway(entry.name)
				return callWithCircuitBreaker(entry.name, async () => ({
					entry,
					stream: gw.stream({
						...request,
						model: request.model ?? entry.model,
						signal: controller.signal,
					}),
				}))
			})

			try {
				const winner = await Promise.any(racePromises)
				controller.abort()
				for await (const event of winner.stream) {
					emit(event)
				}
			} catch {
				emit({
					type: 'error',
					error: new ElsiumError({
						code: 'PROVIDER_ERROR',
						message: 'All providers failed during streaming',
						retryable: false,
					}),
				})
			}
		})
	}

	function streamCapabilityAware(request: CompletionRequest): ElsiumStream {
		const capabilities = detectRequiredCapabilities(request)
		const capable = filterCapableProviders(capabilities)

		if (capable.length === 0) {
			return streamWithFallback(sortedProviders, request)
		}

		return streamWithFallback(capable, request)
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
			switch (config.strategy) {
				case 'fallback':
					return streamWithFallback(sortedProviders, request)
				case 'cost-optimized':
					return streamCostOptimized(request)
				case 'latency-optimized':
					return streamLatencyOptimized(request)
				case 'capability-aware':
					return streamCapabilityAware(request)
				default:
					return streamWithFallback(sortedProviders, request)
			}
		},
	}
}
