import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditEvent } from './audit'
import { createWebhookSink } from './audit-sink-webhook'

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
	return {
		id: 'audit_test_1',
		sequenceId: 1,
		type: 'llm_call',
		timestamp: Date.now(),
		data: { model: 'test' },
		hash: 'abc123',
		previousHash: '0'.repeat(64),
		...overrides,
	}
}

describe('WebhookSink', () => {
	const mockFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()

	beforeEach(() => {
		vi.stubGlobal('fetch', mockFetch)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('sends POST request with correct body and headers', async () => {
		mockFetch.mockResolvedValue(new Response(null, { status: 200 }))

		const sink = createWebhookSink({ url: 'https://hooks.example.com/audit' })
		const events = [makeEvent()]
		await sink.send(events)

		expect(mockFetch).toHaveBeenCalledOnce()
		const [url, options] = mockFetch.mock.calls[0]
		expect(url).toBe('https://hooks.example.com/audit')
		expect(options?.method).toBe('POST')
		expect(options?.headers).toMatchObject({ 'Content-Type': 'application/json' })
		expect(JSON.parse(options?.body as string)).toEqual({ events })
	})

	it('includes custom headers', async () => {
		mockFetch.mockResolvedValue(new Response(null, { status: 200 }))

		const sink = createWebhookSink({
			url: 'https://hooks.example.com/audit',
			headers: { Authorization: 'Bearer token123' },
		})
		await sink.send([makeEvent()])

		const [, options] = mockFetch.mock.calls[0]
		expect(options?.headers).toMatchObject({ Authorization: 'Bearer token123' })
	})

	it('supports PUT method', async () => {
		mockFetch.mockResolvedValue(new Response(null, { status: 200 }))

		const sink = createWebhookSink({
			url: 'https://hooks.example.com/audit',
			method: 'PUT',
		})
		await sink.send([makeEvent()])

		const [, options] = mockFetch.mock.calls[0]
		expect(options?.method).toBe('PUT')
	})

	it('throws on non-ok response', async () => {
		mockFetch.mockResolvedValue(
			new Response(null, { status: 500, statusText: 'Internal Server Error' }),
		)

		const sink = createWebhookSink({ url: 'https://hooks.example.com/audit' })

		await expect(sink.send([makeEvent()])).rejects.toThrow('Webhook responded with 500')
	})

	it('throws on network error', async () => {
		mockFetch.mockRejectedValue(new Error('network down'))

		const sink = createWebhookSink({ url: 'https://hooks.example.com/audit' })

		await expect(sink.send([makeEvent()])).rejects.toThrow('network down')
	})

	it('has name "webhook"', () => {
		const sink = createWebhookSink({ url: 'https://hooks.example.com/audit' })
		expect(sink.name).toBe('webhook')
	})
})
