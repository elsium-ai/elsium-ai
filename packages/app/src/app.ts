import type { Agent } from '@elsium-ai/agents'
import { createLogger } from '@elsium-ai/core'
import { type Gateway, gateway } from '@elsium-ai/gateway'
import { type Tracer, observe } from '@elsium-ai/observe'

const log = createLogger()
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { authMiddleware, corsMiddleware, rateLimitMiddleware } from './middleware'
import { createRoutes } from './routes'
import type { AppConfig } from './types'

export interface ElsiumApp {
	readonly hono: Hono
	readonly gateway: Gateway
	readonly tracer: Tracer
	listen(port?: number): { port: number; stop: () => void }
}

export function createApp(config: AppConfig): ElsiumApp {
	const app = new Hono()

	// ─── Gateway ──────────────────────────────────────────────

	const providerNames = Object.keys(config.gateway.providers)
	const primaryProvider = providerNames[0]
	const primaryConfig = config.gateway.providers[primaryProvider]

	const gw = gateway({
		provider: primaryProvider,
		model: config.gateway.defaultModel,
		apiKey: primaryConfig.apiKey,
		baseUrl: primaryConfig.baseUrl,
	})

	// ─── Tracer ───────────────────────────────────────────────

	const tracer = observe({
		output: config.observe?.tracing ? ['console'] : [],
		costTracking: config.observe?.costTracking ?? true,
	})

	// ─── Middleware ────────────────────────────────────────────

	const serverConfig = config.server ?? {}

	if (serverConfig.cors) {
		app.use('*', corsMiddleware(serverConfig.cors))
	}

	if (serverConfig.auth) {
		app.use('*', authMiddleware(serverConfig.auth))
	}

	if (serverConfig.rateLimit) {
		app.use('*', rateLimitMiddleware(serverConfig.rateLimit))
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

	const routes = createRoutes({
		gateway: gw,
		agents: agentMap,
		defaultAgent,
		tracer,
		startTime: Date.now(),
		version: '0.1.0',
		providers: providerNames,
	})

	app.route('/', routes)

	// ─── Return ───────────────────────────────────────────────

	return {
		hono: app,
		gateway: gw,
		tracer,

		listen(port?: number): { port: number; stop: () => void } {
			const listenPort = port ?? serverConfig.port ?? 3000
			const hostname = serverConfig.hostname ?? '0.0.0.0'

			const server = serve({
				fetch: app.fetch,
				port: listenPort,
				hostname,
			})

			log.info('ElsiumAI server started', {
				url: `http://${hostname}:${listenPort}`,
				routes: ['POST /chat', 'POST /complete', 'GET /health', 'GET /metrics', 'GET /agents'],
			})

			return {
				port: listenPort,
				stop: () => {
					server.close()
				},
			}
		},
	}
}
