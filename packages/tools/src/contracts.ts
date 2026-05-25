export type SideEffectLevel = 'read' | 'write' | 'destructive'

export type RequireApproval = 'auto' | 'always' | 'never'

export interface ApprovalRequest<TInput = unknown> {
	toolName: string
	toolCallId: string
	traceId?: string
	sideEffectLevel?: SideEffectLevel
	input: TInput
	reason?: string
}

export interface ApprovalDecision {
	status: 'approved' | 'rejected'
	reason?: string
	decidedBy?: string
}

export type ApprovalHandler<TInput = unknown> = (
	request: ApprovalRequest<TInput>,
) => Promise<ApprovalDecision> | ApprovalDecision

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
		async get<T>(toolName: string, key: string) {
			return entries.get(composeKey(toolName, key)) as IdempotencyEntry<T> | undefined
		},
		async put<T>(toolName: string, key: string, output: T) {
			const entry: IdempotencyEntry<T> = {
				key,
				toolName,
				output,
				recordedAt: clock(),
			}
			entries.set(composeKey(toolName, key), entry as IdempotencyEntry<unknown>)
			return entry
		},
		async delete(toolName: string, key: string) {
			return entries.delete(composeKey(toolName, key))
		},
	}
}
