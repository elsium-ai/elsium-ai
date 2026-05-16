import type { Agent } from '@elsium-ai/agents'
import {
	ElsiumError,
	type ShutdownManager,
	createLogger,
	createShutdownManager,
} from '@elsium-ai/core'
import { type Gateway, type ProviderMesh, createProviderMesh, gateway } from '@elsium-ai/gateway'
import { type Tracer, observe } from '@elsium-ai/observe'
import type { ServerAdapter } from './adapter'
import { honoAdapter } from './hono-adapter'
import {
	authMiddleware,
	corsMiddleware,
	rateLimitMiddleware,
	requestIdMiddleware,
	requestLoggerMiddleware,
} from './middleware'
import { createRoutes } from './routes'
import type { AppConfig } from './types'

const log = createLogger()

export interface ElsiumApp<TInstance = unknown> {
	readonly instance: TInstance
	readonly gateway: Gateway
	readonly mesh: ProviderMesh | undefined
	readonly tracer: Tracer
	listen(port?: number): { port: number; stop: () => Promise<void> }
}

export function createApp<TInstance = unknown>(config: AppConfig): ElsiumApp<TInstance> {
	const adapter: ServerAdapter<TInstance> =
		(config.server?.adapter as ServerAdapter<TInstance>) ??
		(honoAdapter as unknown as ServerAdapter<TInstance>)

	const app = adapter.create()

	// ─── Global Error Handler ─────────────────────────────────

	adapter.onError(app, (err, c) => {
		const statusCode = err instanceof ElsiumError ? (err.statusCode ?? 500) : 500
		const code = err instanceof ElsiumError ? err.code : 'UNKNOWN'
		log.error('Unhandled error', { error: err.message, code, path: adapter.path(c) })
		return adapter.json(c, { error: err.message, code }, statusCode)
	})

	// ─── Not Found Handler ────────────────────────────────────

	adapter.notFound(app, (c) => {
		return adapter.json(c, { error: 'Not found' }, 404)
	})

	// ─── Gateway ──────────────────────────────────────────────

	const providerNames = Object.keys(config.gateway.providers)

	let gw: Gateway
	let mesh: ProviderMesh | undefined

	if (providerNames.length > 1) {
		const entries = providerNames.map((name) => ({
			name,
			config: {
				apiKey: config.gateway.providers[name].apiKey,
				baseUrl: config.gateway.providers[name].baseUrl,
			},
			model: config.gateway.providers[name].model,
		}))

		mesh = createProviderMesh({
			providers: entries,
			strategy: config.gateway.strategy ?? 'fallback',
		})

		const primaryProvider = providerNames[0]
		const primaryConfig = config.gateway.providers[primaryProvider]
		gw = gateway({
			provider: primaryProvider,
			model: config.gateway.defaultModel,
			apiKey: primaryConfig.apiKey,
			baseUrl: primaryConfig.baseUrl,
		})
	} else {
		const primaryProvider = providerNames[0]
		const primaryConfig = config.gateway.providers[primaryProvider]
		gw = gateway({
			provider: primaryProvider,
			model: config.gateway.defaultModel,
			apiKey: primaryConfig.apiKey,
			baseUrl: primaryConfig.baseUrl,
		})
	}

	// ─── Tracer ───────────────────────────────────────────────

	const tracer = observe({
		output: config.observe?.tracing ? ['console'] : [],
		costTracking: config.observe?.costTracking ?? true,
	})

	// ─── Middleware ────────────────────────────────────────────

	const serverConfig = config.server ?? {}

	adapter.use(app, requestIdMiddleware(adapter))
	adapter.use(app, requestLoggerMiddleware(adapter, log))

	if (serverConfig.cors) {
		adapter.use(app, corsMiddleware(adapter, serverConfig.cors))
	}

	if (serverConfig.auth) {
		adapter.use(app, authMiddleware(adapter, serverConfig.auth))
	}

	if (serverConfig.rateLimit) {
		adapter.use(app, rateLimitMiddleware(adapter, serverConfig.rateLimit))
	}

	// ─── Agents ───────────────────────────────────────────────

	const agentMap = new Map<string, Agent>()
	if (config.agents) {
		for (const agent of config.agents) {
			agentMap.set(agent.name, agent)
		}
	}

	const defaultAgent = config.agents?.[0]

	// ─── Routes ───────────────────────────────────────────────

	const routes = createRoutes(adapter, {
		gateway: gw,
		mesh,
		agents: agentMap,
		defaultAgent,
		tracer,
		startTime: Date.now(),
		version: config.version ?? '0.2.2',
		providers: providerNames,
	})

	adapter.route(app, '/', routes)

	// ─── Return ───────────────────────────────────────────────

	return {
		instance: app,
		gateway: gw,
		mesh,
		tracer,

		listen(port?: number): { port: number; stop: () => Promise<void> } {
			const listenPort = port ?? serverConfig.port ?? 3000
			const hostname = serverConfig.hostname ?? '0.0.0.0'

			const { port: actualPort, close } = adapter.listen(app, listenPort, hostname)

			let shutdownManager: ShutdownManager | undefined
			if (serverConfig.gracefulShutdown) {
				const drainTimeoutMs =
					typeof serverConfig.gracefulShutdown === 'object'
						? serverConfig.gracefulShutdown.drainTimeoutMs
						: undefined
				shutdownManager = createShutdownManager({
					drainTimeoutMs,
					onDrainStart: () => log.info('Draining connections...'),
					onDrainComplete: () => log.info('Drain complete'),
				})
			}

			log.info('ElsiumAI server started', {
				url: `http://${hostname}:${listenPort}`,
				routes: ['POST /chat', 'POST /complete', 'GET /health', 'GET /metrics', 'GET /agents'],
			})

			return {
				port: actualPort,
				stop: async () => {
					if (shutdownManager) {
						await shutdownManager.shutdown()
					}
					close()
				},
			}
		},
	}
}
