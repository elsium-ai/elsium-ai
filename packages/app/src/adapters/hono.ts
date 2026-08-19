import { ElsiumError, type ShutdownManager, createShutdownManager } from '@elsium-ai/core'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import type { AppRuntime, ServerAdapter, ServerHandle, ServerInstance } from '../adapter'
import {
	authMiddleware,
	corsMiddleware,
	rateLimitMiddleware,
	requestIdMiddleware,
	requestLoggerMiddleware,
} from '../middleware'
import { createRoutes } from '../routes'
import type { ServerConfig } from '../types'

/**
 * The Hono adapter's {@link ServerInstance}, additionally exposing the
 * underlying Hono app for advanced mounting, sub-routing, or testing. Code that
 * wants to stay framework-agnostic should depend on {@link ServerInstance}
 * instead.
 */
export interface HonoServerInstance extends ServerInstance {
	readonly hono: Hono
}

function buildHonoApp(config: ServerConfig, runtime: AppRuntime): Hono {
	const app = new Hono()
	const log = runtime.logger

	// ─── Global Error Handler ─────────────────────────────────

	app.onError((err, c) => {
		const statusCode = err instanceof ElsiumError ? (err.statusCode ?? 500) : 500
		const code = err instanceof ElsiumError ? err.code : 'UNKNOWN'
		log.error('Unhandled error', { error: err.message, code, path: c.req.path })
		return c.json({ error: err.message, code }, statusCode as 500)
	})

	// ─── Not Found Handler ────────────────────────────────────

	app.notFound((c) => c.json({ error: 'Not found' }, 404))

	// ─── Middleware ───────────────────────────────────────────

	app.use('*', requestIdMiddleware())
	app.use('*', requestLoggerMiddleware(log))

	if (config.cors) app.use('*', corsMiddleware(config.cors))
	if (config.auth) app.use('*', authMiddleware(config.auth))
	if (config.rateLimit) app.use('*', rateLimitMiddleware(config.rateLimit))

	// ─── Routes ───────────────────────────────────────────────

	app.route(
		'/',
		createRoutes({
			gateway: runtime.gateway,
			mesh: runtime.mesh,
			agents: runtime.agents,
			defaultAgent: runtime.defaultAgent,
			tracer: runtime.tracer,
			startTime: runtime.startTime,
			version: runtime.version,
			providers: runtime.providers,
		}),
	)

	return app
}

class HonoServerAdapter implements ServerAdapter {
	constructor(readonly config: ServerConfig) {}

	bind(runtime: AppRuntime): HonoServerInstance {
		const app = buildHonoApp(this.config, runtime)
		const { config } = this
		const log = runtime.logger

		return {
			hono: app,

			fetch: (request) => app.fetch(request),

			listen(port?: number): ServerHandle {
				const listenPort = port ?? config.port ?? 3000
				const hostname = config.hostname ?? '0.0.0.0'

				const server = serve({ fetch: app.fetch, port: listenPort, hostname })

				let shutdownManager: ShutdownManager | undefined
				if (config.gracefulShutdown) {
					const drainTimeoutMs =
						typeof config.gracefulShutdown === 'object'
							? config.gracefulShutdown.drainTimeoutMs
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
					port: listenPort,
					stop: async () => {
						if (shutdownManager) await shutdownManager.shutdown()
						server.close()
					},
				}
			},
		}
	}
}

/**
 * The built-in Hono server adapter. Pass its result to
 * `createApp({ server: createServer({...}) })`.
 *
 * All Hono-specific code lives behind this factory, so a future
 * `@elsium-ai/server-*` package can provide a drop-in replacement that
 * satisfies the same {@link ServerAdapter} contract.
 */
export function createServer(config: ServerConfig = {}): ServerAdapter {
	return new HonoServerAdapter(config)
}
