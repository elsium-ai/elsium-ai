import type { Agent } from '@elsium-ai/agents'
import { type Logger, createLogger } from '@elsium-ai/core'
import { type Gateway, type ProviderMesh, createProviderMesh, gateway } from '@elsium-ai/gateway'
import { type Tracer, observe } from '@elsium-ai/observe'
import {
	type ServerAdapter,
	type ServerHandle,
	type ServerInstance,
	isServerAdapter,
} from './adapter'
import { type HonoServerInstance, createServer } from './hono/adapter'
import type { AppConfig } from './types'

const DEFAULT_VERSION = '0.2.2'

export interface ElsiumApp<S extends ServerInstance = HonoServerInstance> {
	readonly gateway: Gateway
	readonly mesh: ProviderMesh | undefined
	readonly tracer: Tracer
	/** The bound server instance produced by the configured adapter. */
	readonly server: S
	/** Web-standard request handler, delegated to the server adapter. */
	fetch(request: Request): Response | Promise<Response>
	listen(port?: number): ServerHandle
}

function buildGateway(config: AppConfig['gateway']): {
	gateway: Gateway
	mesh: ProviderMesh | undefined
	providers: string[]
} {
	const providers = Object.keys(config.providers)
	const primary = providers[0]
	const primaryConfig = config.providers[primary]

	const gw = gateway({
		provider: primary,
		model: config.defaultModel,
		apiKey: primaryConfig.apiKey,
		baseUrl: primaryConfig.baseUrl,
	})

	let mesh: ProviderMesh | undefined
	if (providers.length > 1) {
		mesh = createProviderMesh({
			providers: providers.map((name) => ({
				name,
				config: {
					apiKey: config.providers[name].apiKey,
					baseUrl: config.providers[name].baseUrl,
				},
				model: config.providers[name].model,
			})),
			strategy: config.strategy ?? 'fallback',
		})
	}

	return { gateway: gw, mesh, providers }
}

export function createApp<S extends ServerInstance = HonoServerInstance>(
	config: AppConfig<S>,
): ElsiumApp<S> {
	const logger: Logger = createLogger()

	// ─── Gateway ──────────────────────────────────────────────

	const { gateway: gw, mesh, providers } = buildGateway(config.gateway)

	// ─── Tracer ───────────────────────────────────────────────

	const tracer = observe({
		output: config.observe?.tracing ? ['console'] : [],
		costTracking: config.observe?.costTracking ?? true,
	})

	// ─── Agents ───────────────────────────────────────────────

	const agents = new Map<string, Agent>()
	if (config.agents) {
		for (const agent of config.agents) agents.set(agent.name, agent)
	}
	const defaultAgent = config.agents?.[0]

	// ─── Server Adapter ───────────────────────────────────────
	// Accept an adapter (new API: `server: createServer({...})`) or a bare
	// HonoServerConfig, which we wrap in the default Hono adapter for convenience.

	// `isServerAdapter` only narrows to the erased `ServerAdapter<ServerInstance>`
	// — generics don't exist at runtime — so this cast trusts the caller's own
	// `S` type argument to match what their adapter's `bind()` actually returns,
	// the same trust boundary as any other TS generic factory (e.g. JSON.parse<T>()).
	const adapter = (
		isServerAdapter(config.server) ? config.server : createServer(config.server ?? {})
	) as ServerAdapter<S>

	const server = adapter.bind({
		gateway: gw,
		mesh,
		agents,
		defaultAgent,
		tracer,
		logger,
		version: config.version ?? DEFAULT_VERSION,
		providers,
		startTime: Date.now(),
	})

	return {
		gateway: gw,
		mesh,
		tracer,
		server,
		fetch: (request) => server.fetch(request),
		listen: (port) => server.listen(port),
	}
}
