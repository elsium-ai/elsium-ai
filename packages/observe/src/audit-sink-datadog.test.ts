import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditEvent } from './audit'
import { createDatadogSink } from './audit-sink-datadog'

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
	return {
		id: 'audit_test_1',
		sequenceId: 1,
		type: 'provider_failover',
		timestamp: 1700000000000,
		data: { from: 'openai', to: 'anthropic' },
		hash: 'abc123',
		previousHash: '0'.repeat(64),
		...overrides,
	}
}

describe('DatadogSink', () => {
	const mockFetch = vi.fn<typeof fetch>()

	beforeEach(() => {
		vi.stubGlobal('fetch', mockFetch)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.clearAllMocks()
	})

	it('sends events to Datadog Log Intake API', async () => {
		mockFetch.mockResolvedValue(new Response(null, { status: 202 }))

		const sink = createDatadogSink({ apiKey: 'dd-key-123' })
		await sink.send([makeEvent()])

		expect(mockFetch).toHaveBeenCalledOnce()
		const [url, options] = mockFetch.mock.calls[0]
		expect(url).toBe('https://http-intake.logs.datadoghq.com/api/v2/logs')
		expect(options?.method).toBe('POST')
	})

	it('sets DD-API-KEY header', async () => {
		mockFetch.mockResolvedValue(new Response(null, { status: 202 }))

		const sink = createDatadogSink({ apiKey: 'dd-key-123' })
		await sink.send([makeEvent()])

		const [, options] = mockFetch.mock.calls[0]
		expect(options?.headers).toMatchObject({ 'DD-API-KEY': 'dd-key-123' })
	})

	it('uses correct endpoint for custom site', async () => {
		mockFetch.mockResolvedValue(new Response(null, { status: 202 }))

		const sink = createDatadogSink({ apiKey: 'key', site: 'datadoghq.eu' })
		await sink.send([makeEvent()])

		const [url] = mockFetch.mock.calls[0]
		expect(url).toBe('https://http-intake.logs.datadoghq.eu/api/v2/logs')
	})

	it('formats events with correct structure', async () => {
		mockFetch.mockResolvedValue(new Response(null, { status: 202 }))

		const sink = createDatadogSink({
			apiKey: 'key',
			service: 'my-service',
			source: 'my-source',
			tags: { env: 'production', team: 'platform' },
		})
		await sink.send([makeEvent()])

		const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string)
		expect(body).toHaveLength(1)
		expect(body[0].ddsource).toBe('my-source')
		expect(body[0].service).toBe('my-service')
		expect(body[0].ddtags).toBe('env:production,team:platform')
		expect(body[0].audit.type).toBe('provider_failover')
		expect(body[0].timestamp).toBe(1700000000000)
	})

	it('marks security_violation events as error status', async () => {
		mockFetch.mockResolvedValue(new Response(null, { status: 202 }))

		const sink = createDatadogSink({ apiKey: 'key' })
		await sink.send([makeEvent({ type: 'security_violation' })])

		const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string)
		expect(body[0].status).toBe('error')
	})

	it('marks non-security events as info status', async () => {
		mockFetch.mockResolvedValue(new Response(null, { status: 202 }))

		const sink = createDatadogSink({ apiKey: 'key' })
		await sink.send([makeEvent({ type: 'llm_call' })])

		const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string)
		expect(body[0].status).toBe('info')
	})

	it('throws on non-ok response', async () => {
		mockFetch.mockResolvedValue(new Response(null, { status: 403, statusText: 'Forbidden' }))

		const sink = createDatadogSink({ apiKey: 'bad-key' })

		await expect(sink.send([makeEvent()])).rejects.toThrow('Datadog Log Intake responded with 403')
	})

	it('has name "datadog"', () => {
		const sink = createDatadogSink({ apiKey: 'key' })
		expect(sink.name).toBe('datadog')
	})
})
