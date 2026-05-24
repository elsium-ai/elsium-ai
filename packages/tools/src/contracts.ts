export type SideEffectLevel = 'read' | 'write' | 'destructive'

export interface PreconditionResult {
	ok: boolean
	reason?: string
}

export type PreconditionFn<TInput = unknown> = (
	input: TInput,
	context: { toolCallId: string; traceId?: string },
) => Promise<PreconditionResult> | PreconditionResult

export interface PreconditionFailure {
	name: string
	reason: string
}

export interface IdempotencyEntry<TOutput = unknown> {
	key: string
	toolName: string
	output: TOutput
	recordedAt: number
}

export interface IdempotencyStore {
	get<T>(toolName: string, key: string): Promise<IdempotencyEntry<T> | undefined>
	put<T>(toolName: string, key: string, output: T): Promise<IdempotencyEntry<T>>
	delete(toolName: string, key: string): Promise<boolean>
}

export interface InMemoryIdempotencyStoreConfig {
	clock?: () => number
}

export function createInMemoryIdempotencyStore(
	config: InMemoryIdempotencyStoreConfig = {},
): IdempotencyStore {
	const clock = config.clock ?? (() => Date.now())
	const entries = new Map<string, IdempotencyEntry<unknown>>()

	const composeKey = (toolName: string, key: string): string => `${toolName}::${key}`

	return {
		async get<T>(toolName, key) {
			return entries.get(composeKey(toolName, key)) as IdempotencyEntry<T> | undefined
		},
		async put<T>(toolName, key, output) {
			const entry: IdempotencyEntry<T> = {
				key,
				toolName,
				output,
				recordedAt: clock(),
			}
			entries.set(composeKey(toolName, key), entry as IdempotencyEntry<unknown>)
			return entry
		},
		async delete(toolName, key) {
			return entries.delete(composeKey(toolName, key))
		},
	}
}
