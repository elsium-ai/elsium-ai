import { describe, expect, it } from 'vitest'
import { createProvenanceTracker } from './provenance'

describe('ProvenanceTracker', () => {
	it('records provenance and returns record', () => {
		const tracker = createProvenanceTracker()

		const record = tracker.record({
			prompt: 'Translate to French',
			model: 'gpt-4o',
			config: { temperature: 0 },
			input: 'Hello world',
			output: 'Bonjour le monde',
		})

		expect(record.id).toMatch(/^prov_/)
		expect(record.outputHash).toBeTruthy()
		expect(record.promptVersion).toBeTruthy()
		expect(record.modelVersion).toBeTruthy()
		expect(record.configHash).toBeTruthy()
		expect(record.inputHash).toBeTruthy()
		expect(record.timestamp).toBeGreaterThan(0)
		expect(tracker.count).toBe(1)
	})

	it('generates deterministic hashes for same content', () => {
		const tracker = createProvenanceTracker()

		const r1 = tracker.record({
			prompt: 'test',
			model: 'gpt-4o',
			config: {},
			input: 'hi',
			output: 'hello',
		})
		const r2 = tracker.record({
			prompt: 'test',
			model: 'gpt-4o',
			config: {},
			input: 'hi',
			output: 'hello',
		})

		expect(r1.outputHash).toBe(r2.outputHash)
		expect(r1.promptVersion).toBe(r2.promptVersion)
		expect(r1.inputHash).toBe(r2.inputHash)
	})

	it('queries by outputHash', () => {
		const tracker = createProvenanceTracker()

		const r1 = tracker.record({
			prompt: 'p1',
			model: 'm1',
			config: {},
			input: 'i1',
			output: 'o1',
		})
		tracker.record({
			prompt: 'p2',
			model: 'm2',
			config: {},
			input: 'i2',
			output: 'o2',
		})

		const results = tracker.query({ outputHash: r1.outputHash })
		expect(results).toHaveLength(1)
		expect(results[0].id).toBe(r1.id)
	})

	it('queries by promptVersion', () => {
		const tracker = createProvenanceTracker()

		tracker.record({
			prompt: 'same-prompt',
			model: 'm1',
			config: {},
			input: 'i1',
			output: 'o1',
		})
		tracker.record({
			prompt: 'same-prompt',
			model: 'm2',
			config: {},
			input: 'i2',
			output: 'o2',
		})
		tracker.record({
			prompt: 'different',
			model: 'm3',
			config: {},
			input: 'i3',
			output: 'o3',
		})

		const results = tracker.query({
			promptVersion: tracker.query({})[0].promptVersion,
		})
		expect(results).toHaveLength(2)
	})

	it('queries by traceId', () => {
		const tracker = createProvenanceTracker()

		tracker.record({
			prompt: 'p1',
			model: 'm1',
			config: {},
			input: 'i1',
			output: 'o1',
			traceId: 'trace-a',
		})
		tracker.record({
			prompt: 'p2',
			model: 'm2',
			config: {},
			input: 'i2',
			output: 'o2',
			traceId: 'trace-b',
		})

		const results = tracker.query({ traceId: 'trace-a' })
		expect(results).toHaveLength(1)
	})

	it('getLineage returns records sharing traceId', () => {
		const tracker = createProvenanceTracker()

		const r1 = tracker.record({
			prompt: 'p1',
			model: 'm1',
			config: {},
			input: 'i1',
			output: 'o1',
			traceId: 'trace-x',
		})
		tracker.record({
			prompt: 'p2',
			model: 'm2',
			config: {},
			input: 'o1',
			output: 'o2',
			traceId: 'trace-x',
		})
		tracker.record({
			prompt: 'p3',
			model: 'm3',
			config: {},
			input: 'i3',
			output: 'o3',
			traceId: 'trace-y',
		})

		const lineage = tracker.getLineage(r1.outputHash)
		expect(lineage).toHaveLength(2)
		expect(lineage[0].timestamp).toBeLessThanOrEqual(lineage[1].timestamp)
	})

	it('getLineage returns single record if no traceId', () => {
		const tracker = createProvenanceTracker()

		const r1 = tracker.record({
			prompt: 'p1',
			model: 'm1',
			config: {},
			input: 'i1',
			output: 'o1',
		})

		const lineage = tracker.getLineage(r1.outputHash)
		expect(lineage).toHaveLength(1)
	})

	it('getLineage returns empty for unknown hash', () => {
		const tracker = createProvenanceTracker()
		const lineage = tracker.getLineage('unknown-hash')
		expect(lineage).toHaveLength(0)
	})

	it('clear removes all records', () => {
		const tracker = createProvenanceTracker()
		tracker.record({
			prompt: 'p1',
			model: 'm1',
			config: {},
			input: 'i1',
			output: 'o1',
		})
		expect(tracker.count).toBe(1)

		tracker.clear()
		expect(tracker.count).toBe(0)
	})

	it('stores metadata', () => {
		const tracker = createProvenanceTracker()

		const record = tracker.record({
			prompt: 'p1',
			model: 'm1',
			config: {},
			input: 'i1',
			output: 'o1',
			metadata: { environment: 'production' },
		})

		expect(record.metadata).toEqual({ environment: 'production' })
	})
})
