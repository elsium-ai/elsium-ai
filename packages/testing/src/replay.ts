import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'

export interface ReplayEntry {
	request: CompletionRequest
	response: LLMResponse
	timestamp: number
}

export interface ReplayRecorder {
	wrap(
		completeFn: (req: CompletionRequest) => Promise<LLMResponse>,
	): (req: CompletionRequest) => Promise<LLMResponse>
	getEntries(): ReplayEntry[]
	toJSON(): string
	clear(): void
}

export interface ReplayPlayer {
	complete(request: CompletionRequest): Promise<LLMResponse>
	readonly remaining: number
}

export function createReplayRecorder(): ReplayRecorder {
	const entries: ReplayEntry[] = []

	return {
		wrap(
			completeFn: (req: CompletionRequest) => Promise<LLMResponse>,
		): (req: CompletionRequest) => Promise<LLMResponse> {
			return async (request: CompletionRequest): Promise<LLMResponse> => {
				const response = await completeFn(request)
				entries.push({
					request,
					response,
					timestamp: Date.now(),
				})
				return response
			}
		},

		getEntries(): ReplayEntry[] {
			return [...entries]
		},

		toJSON(): string {
			return JSON.stringify(entries, null, 2)
		},

		clear(): void {
			entries.length = 0
		},
	}
}

export function createReplayPlayer(entriesOrJson: ReplayEntry[] | string): ReplayPlayer {
	const entries =
		typeof entriesOrJson === 'string'
			? (JSON.parse(entriesOrJson) as ReplayEntry[])
			: [...entriesOrJson]
	let index = 0

	return {
		get remaining() {
			return entries.length - index
		},

		async complete(_request: CompletionRequest): Promise<LLMResponse> {
			if (index >= entries.length) {
				throw new Error('Replay exhausted: no more recorded responses')
			}

			const entry = entries[index]
			index++
			return entry.response
		},
	}
}
