import { createHash } from 'node:crypto'
import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'
import { type MockProvider, type MockResponseConfig, mockProvider } from './mock-provider'

export interface FixtureEntry {
	request: {
		messages: Array<{ role: string; content: string }>
		model?: string
		system?: string
	}
	response: MockResponseConfig
	timestamp?: string
}

export interface Fixture {
	readonly name: string
	readonly entries: FixtureEntry[]
	toProvider(options?: { matching?: 'sequential' | 'request-hash' }): MockProvider
	toJSON(): string
}

function hashMessages(messages: Array<{ role: string; content: string }>): string {
	const content = messages.map((m) => `${m.role}:${m.content}`).join('|')
	return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

export function createFixture(name: string, entries: FixtureEntry[]): Fixture {
	return {
		name,
		entries,

		toProvider(options?: { matching?: 'sequential' | 'request-hash' }): MockProvider {
			if (options?.matching === 'request-hash') {
				const hashMap = new Map<string, MockResponseConfig>()
				for (const entry of entries) {
					const hash = hashMessages(entry.request.messages)
					hashMap.set(hash, entry.response)
				}

				const provider = mockProvider({
					responses: entries.map((e) => e.response),
				})

				const originalComplete = provider.complete.bind(provider)
				const wrapped = Object.create(provider) as MockProvider
				wrapped.complete = async (request: CompletionRequest): Promise<LLMResponse> => {
					const reqMessages = request.messages.map((m) => ({
						role: m.role,
						content: typeof m.content === 'string' ? m.content : '[complex]',
					}))
					const hash = hashMessages(reqMessages)
					const matched = hashMap.get(hash)

					if (matched) {
						return mockProvider({ responses: [matched] }).complete(request)
					}

					// Fallback to sequential
					return originalComplete(request)
				}

				return wrapped
			}

			return mockProvider({
				responses: entries.map((e) => e.response),
			})
		},

		toJSON(): string {
			return JSON.stringify(
				{
					name,
					entries: entries.map((e) => ({
						...e,
						timestamp: e.timestamp ?? new Date().toISOString(),
					})),
				},
				null,
				2,
			)
		},
	}
}

export function loadFixture(json: string): Fixture {
	const data = JSON.parse(json) as { name: string; entries: FixtureEntry[] }
	return createFixture(data.name, data.entries)
}

// ─── Recorder ────────────────────────────────────────────────────

export interface FixtureRecorder {
	wrap(provider: MockProvider): MockProvider
	getEntries(): FixtureEntry[]
	toFixture(name: string): Fixture
	clear(): void
}

export function createRecorder(): FixtureRecorder {
	const entries: FixtureEntry[] = []

	return {
		wrap(provider: MockProvider): MockProvider {
			const originalComplete = provider.complete.bind(provider)

			const wrapped = Object.create(provider) as MockProvider
			wrapped.complete = async (request: CompletionRequest): Promise<LLMResponse> => {
				const response = await originalComplete(request)

				entries.push({
					request: {
						messages: request.messages.map((m) => ({
							role: m.role,
							content: typeof m.content === 'string' ? m.content : '[complex]',
						})),
						model: request.model,
						system: request.system,
					},
					response: {
						content: typeof response.message.content === 'string' ? response.message.content : '',
						toolCalls: response.message.toolCalls,
						stopReason: response.stopReason,
						usage: response.usage,
						model: response.model,
					},
					timestamp: new Date().toISOString(),
				})

				return response
			}

			return wrapped
		},

		getEntries() {
			return [...entries]
		},

		toFixture(name: string): Fixture {
			return createFixture(name, [...entries])
		},

		clear() {
			entries.length = 0
		},
	}
}
