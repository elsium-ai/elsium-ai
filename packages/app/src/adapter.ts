import type { Agent } from '@elsium-ai/agents'
import type { Logger } from '@elsium-ai/core'
import type { Gateway, ProviderMesh } from '@elsium-ai/gateway'
import type { Tracer } from '@elsium-ai/observe'

/**
 * Framework-neutral runtime that the app module resolves and hands to a server
 * adapter. It intentionally contains no HTTP-framework types (no Hono, no
 * Express), so any adapter — the built-in Hono one today, or a replacement
 * shipped from a separate package tomorrow — can bind it and serve requests.
 */
export interface AppRuntime {
	readonly gateway: Gateway
	readonly mesh: ProviderMesh | undefined
	readonly agents: Map<string, Agent>
	readonly defaultAgent: Agent | undefined
	readonly tracer: Tracer
	readonly logger: Logger
	readonly version: string
	readonly providers: string[]
	/** Epoch ms captured when the app was created; used for uptime reporting. */
	readonly startTime: number
}

/** Handle to a running server, returned by {@link ServerInstance.listen}. */
export interface ServerHandle {
	readonly port: number
	stop(): Promise<void>
}

/**
 * A server bound to an {@link AppRuntime} and ready to handle requests.
 *
 * `fetch` is the web-standard `Request`/`Response` handler, so an instance can
 * be mounted into any host that speaks fetch (edge runtimes, tests, another
 * framework). `listen` starts a standalone HTTP server on a port.
 */
export interface ServerInstance {
	fetch(request: Request): Response | Promise<Response>
	listen(port?: number): ServerHandle
}

/**
 * A pluggable server adapter. Produced by an adapter factory such as
 * `createServer` (the built-in Hono adapter). The adapter owns every
 * HTTP-framework concern — routing, middleware wiring, and the network layer —
 * behind this boundary, so it can later live in a dedicated package and be
 * swapped in through the `server` field of `AppConfig` without touching the
 * app module.
 *
 * The type parameter carries the concrete {@link ServerInstance} an adapter
 * binds to, so an adapter that returns a richer instance (e.g. the Hono
 * adapter's `HonoServerInstance`) keeps that type through `bind()` without a
 * cast.
 */
export interface ServerAdapter<S extends ServerInstance = ServerInstance> {
	/** Bind the app runtime and return a ready-to-serve instance. */
	bind(runtime: AppRuntime): S
}

/**
 * Distinguishes a {@link ServerAdapter} from a plain config object (e.g. the
 * Hono adapter's `HonoServerConfig`). Lets `createApp` accept either the
 * adapter API (`server: createServer({...})`) or a bare config object for
 * convenience.
 *
 * This is structural (checks for a callable `bind`), not a branded check, so
 * it stays accurate only as long as no adapter config type ever defines its
 * own `bind` field. If one needs to, give `ServerAdapter` a brand instead of
 * adding a naming convention here.
 */
export function isServerAdapter(value: unknown): value is ServerAdapter {
	return (
		typeof value === 'object' &&
		value !== null &&
		'bind' in value &&
		typeof (value as ServerAdapter).bind === 'function'
	)
}
