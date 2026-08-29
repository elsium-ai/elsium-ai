import { defineAgent } from '@elsium-ai/agents'
import { createApp } from '@elsium-ai/app'
/**
 * Test 03: Building a Server
 * Verifies: createApp, HTTP routes (via the server adapter's fetch handler)
 */
import { describe, expect, it } from 'vitest'
import { assertNonEmptyString, createTestComplete, describeWithLLM } from '../lib/helpers'

describe('03 — Building a Server', () => {
	it('createApp returns fetch, gateway, tracer, and listen', () => {
		const app = createApp({
			gateway: {
				providers: { openai: { apiKey: 'sk-fake-key' } },
				defaultModel: 'gpt-4o',
			},
		})

		expect(typeof app.fetch).toBe('function')
		expect(app.gateway).toBeDefined()
		expect(app.tracer).toBeDefined()
		expect(typeof app.listen).toBe('function')
	})

	it('createApp serves the /health route', async () => {
		const app = createApp({
			gateway: {
				providers: { openai: { apiKey: 'sk-fake-key' } },
			},
		})

		const res = await app.fetch(new Request('http://localhost/health'))
		expect(res.status).toBe(200)

		const body = (await res.json()) as { status: string }
		expect(body.status).toBe('ok')
	})

	it('createApp with server config options', () => {
		const app = createApp({
			gateway: {
				providers: { openai: { apiKey: 'sk-fake-key' } },
			},
			server: {
				port: 4567,
				cors: true,
			},
			observe: {
				tracing: false,
				costTracking: true,
			},
		})

		expect(typeof app.fetch).toBe('function')
		expect(app.gateway).toBeDefined()
	})
})

describeWithLLM('03 — Building a Server (Real LLM)', () => {
	it('/complete returns real LLM response', async () => {
		const apiKey = process.env.OPENAI_API_KEY as string

		const app = createApp({
			gateway: {
				providers: { openai: { apiKey } },
				defaultModel: 'gpt-4o-mini',
			},
		})

		const res = await app.fetch(
			new Request('http://localhost/complete', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					messages: [{ role: 'user', content: 'Say hi in one word.' }],
					maxTokens: 10,
				}),
			}),
		)

		expect(res.status).toBe(200)
		const body = (await res.json()) as { message: unknown }
		expect(body.message).toBeDefined()
	})

	it('/chat returns real agent response', async () => {
		const complete = createTestComplete()

		const agent = defineAgent(
			{ name: 'test-chat', system: 'You are helpful. Respond in under 5 words.' },
			{ complete },
		)

		const apiKey = process.env.OPENAI_API_KEY as string

		const app = createApp({
			gateway: {
				providers: { openai: { apiKey } },
				defaultModel: 'gpt-4o-mini',
			},
			agents: [agent],
		})

		const res = await app.fetch(
			new Request('http://localhost/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: 'Hello!' }),
			}),
		)

		expect(res.status).toBe(200)
		const body = (await res.json()) as { message: string }
		expect(typeof body.message).toBe('string')
		assertNonEmptyString(body.message)
	})
})
