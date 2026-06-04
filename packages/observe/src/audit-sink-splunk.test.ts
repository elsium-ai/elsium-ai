import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditEvent } from './audit'
import { createSplunkSink } from './audit-sink-splunk'

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
	return {
		id: 'audit_test_1',
		sequenceId: 1,
		type: 'security_violation',
		timestamp: 1700000000000,
		data: { threat: 'injection' },
		hash: 'abc123',
		previousHash: '0'.repeat(64),
		...overrides,
	}
}

describe('SplunkSink', () => {
	const mockFetch = vi.fn<typeof fetch>()

	beforeEach(() => {
		vi.stubGlobal('fetch', mockFetch)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.clearAllMocks()
	})

	it('sends events as newline-delimited Splunk HEC JSON', async () => {
		mockFetch.mockResolvedValue(new Response(null, { status: 200 }))

		const sink = createSplunkSink({
			url: 'https://splunk:8088/services/collector',
			token: 'hec-token-123',
		})
		await sink.send([makeEvent(), makeEvent({ sequenceId: 2 })])

		expect(mockFetch).toHaveBeenCalledOnce()
		const [, options] = mockFetch.mock.calls[0]
		const lines = (options?.body as string).split('\n')
		expect(lines).toHaveLength(2)

		const parsed = JSON.parse(lines[0])
		expect(parsed.time).toBe(1700000000)
		expect(parsed.source).toBe('elsium-ai')
		expect(parsed.sourcetype).toBe('elsium:audit')
		expect(parsed.event.type).toBe('security_violation')
	})

	it('sets Authorization header with Splunk token', async () => {
		mockFetch.mockResolvedValue(new Response(null, { status: 200 }))

		const sink = createSplunkSink({
			url: 'https://splunk:8088/services/collector',
			token: 'hec-token-123',
		})
		await sink.send([makeEvent()])

		const [, options] = mockFetch.mock.calls[0]
		expect(options?.headers).toMatchObject({ Authorization: 'Splunk hec-token-123' })
	})

	it('includes custom index, source, and sourcetype', async () => {
		mockFetch.mockResolvedValue(new Response(null, { status: 200 }))

		const sink = createSplunkSink({
			url: 'https://splunk:8088/services/collector',
			token: 'tok',
			index: 'ai_audit',
			source: 'my-app',
			sourcetype: 'custom:type',
		})
		await sink.send([makeEvent()])

		const body = mockFetch.mock.calls[0][1]?.body as string
		const parsed = JSON.parse(body)
		expect(parsed.index).toBe('ai_audit')
		expect(parsed.source).toBe('my-app')
		expect(parsed.sourcetype).toBe('custom:type')
	})

	it('throws on non-ok response', async () => {
		mockFetch.mockResolvedValue(new Response(null, { status: 403, statusText: 'Forbidden' }))

		const sink = createSplunkSink({
			url: 'https://splunk:8088/services/collector',
			token: 'bad-token',
		})

		await expect(sink.send([makeEvent()])).rejects.toThrow('Splunk HEC responded with 403')
	})

	it('has name "splunk"', () => {
		const sink = createSplunkSink({
			url: 'https://splunk:8088/services/collector',
			token: 'tok',
		})
		expect(sink.name).toBe('splunk')
	})
})
