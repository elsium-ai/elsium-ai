export type Capability =
	| 'network'
	| 'fs:read'
	| 'fs:write'
	| 'subprocess'
	| `network:${string}`
	| `fs:read:${string}`
	| `fs:write:${string}`
	| (string & {})

export interface SandboxConfig {
	mode: 'worker' | 'process'
	handler: URL | string
	timeoutMs?: number
	capabilities?: Capability[]
	env?: Record<string, string>
}

export interface SandboxRunner {
	invoke(input: unknown, signal?: AbortSignal): Promise<unknown>
	dispose(): Promise<void>
}
