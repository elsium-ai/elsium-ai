import { describe, expect, it, vi } from 'vitest'
import {
	createFixture,
	createRecorder,
	createSnapshotStore,
	formatEvalReport,
	hashOutput,
	loadFixture,
	mockProvider,
	runEvalSuite,
	testSnapshot,
} from './index'

// ─── Mock Provider ───────────────────────────────────────────────

describe('mockProvider', () => {
	it('returns configured responses in order', async () => {
		const mock = mockProvider({
			responses: [{ content: 'First response' }, { content: 'Second response' }],
		})

		const r1 = await mock.complete({ messages: [{ role: 'user', content: 'Hi' }] })
		const r2 = await mock.complete({ messages: [{ role: 'user', content: 'Hello' }] })

		expect(r1.message.content).toBe('First response')
		expect(r2.message.content).toBe('Second response')
	})

	it('tracks all calls', async () => {
		const mock = mockProvider({ responses: [{ content: 'ok' }] })

		await mock.complete({ messages: [{ role: 'user', content: 'test' }] })

		expect(mock.callCount).toBe(1)
		expect(mock.calls[0].messages[0].content).toBe('test')
	})

	it('uses default response when responses exhausted', async () => {
		const mock = mockProvider({
			responses: [{ content: 'first' }],
			defaultResponse: { content: 'default' },
		})

		await mock.complete({ messages: [] })
		const r2 = await mock.complete({ messages: [] })

		expect(r2.message.content).toBe('default')
	})

	it('returns tool calls', async () => {
		const mock = mockProvider({
			responses: [
				{
					content: '',
					toolCalls: [{ name: 'search', arguments: { q: 'test' } }],
					stopReason: 'tool_use',
				},
			],
		})

		const result = await mock.complete({ messages: [] })

		expect(result.message.toolCalls).toHaveLength(1)
		expect(result.message.toolCalls?.[0].name).toBe('search')
		expect(result.stopReason).toBe('tool_use')
	})

	it('calls onRequest callback', async () => {
		const onRequest = vi.fn()
		const mock = mockProvider({
			responses: [{ content: 'ok' }],
			onRequest,
		})

		await mock.complete({ messages: [{ role: 'user', content: 'test' }] })

		expect(onRequest).toHaveBeenCalledOnce()
	})

	it('streams text word by word', async () => {
		const mock = mockProvider({
			responses: [{ content: 'Hello World Test' }],
		})

		const stream = mock.stream({ messages: [] })
		const text = await stream.toText()

		expect(text).toContain('Hello')
		expect(text).toContain('World')
	})

	it('resets state', async () => {
		const mock = mockProvider({
			responses: [{ content: 'first' }, { content: 'second' }],
		})

		await mock.complete({ messages: [] })
		expect(mock.callCount).toBe(1)

		mock.reset()
		expect(mock.callCount).toBe(0)

		const r = await mock.complete({ messages: [] })
		expect(r.message.content).toBe('first')
	})
})

// ─── Fixtures ────────────────────────────────────────────────────

describe('Fixtures', () => {
	it('creates fixture from entries', () => {
		const fixture = createFixture('test-fixture', [
			{
				request: {
					messages: [{ role: 'user', content: 'Hello' }],
				},
				response: { content: 'Hi there!' },
			},
			{
				request: {
					messages: [{ role: 'user', content: 'How are you?' }],
				},
				response: { content: 'I am well!' },
			},
		])

		expect(fixture.name).toBe('test-fixture')
		expect(fixture.entries).toHaveLength(2)
	})

	it('converts fixture to mock provider', async () => {
		const fixture = createFixture('test', [
			{
				request: { messages: [{ role: 'user', content: 'Q1' }] },
				response: { content: 'A1' },
			},
			{
				request: { messages: [{ role: 'user', content: 'Q2' }] },
				response: { content: 'A2' },
			},
		])

		const provider = fixture.toProvider()
		const r1 = await provider.complete({ messages: [] })
		const r2 = await provider.complete({ messages: [] })

		expect(r1.message.content).toBe('A1')
		expect(r2.message.content).toBe('A2')
	})

	it('serializes and deserializes fixtures', () => {
		const original = createFixture('roundtrip', [
			{
				request: { messages: [{ role: 'user', content: 'Hi' }] },
				response: { content: 'Hello!' },
			},
		])

		const json = original.toJSON()
		const loaded = loadFixture(json)

		expect(loaded.name).toBe('roundtrip')
		expect(loaded.entries).toHaveLength(1)
		expect(loaded.entries[0].response.content).toBe('Hello!')
	})

	it('records interactions', async () => {
		const recorder = createRecorder()
		const mock = mockProvider({
			responses: [{ content: 'recorded response' }],
		})

		const wrapped = recorder.wrap(mock)
		await wrapped.complete({
			messages: [{ role: 'user', content: 'test input' }],
			system: 'You are helpful.',
		})

		const entries = recorder.getEntries()
		expect(entries).toHaveLength(1)
		expect(entries[0].request.messages[0].content).toBe('test input')
		expect(entries[0].request.system).toBe('You are helpful.')
		expect(entries[0].response.content).toBe('recorded response')
	})

	it('converts recordings to fixture', async () => {
		const recorder = createRecorder()
		const mock = mockProvider({
			responses: [{ content: 'r1' }, { content: 'r2' }],
		})

		const wrapped = recorder.wrap(mock)
		await wrapped.complete({ messages: [{ role: 'user', content: 'q1' }] })
		await wrapped.complete({ messages: [{ role: 'user', content: 'q2' }] })

		const fixture = recorder.toFixture('recorded')
		expect(fixture.name).toBe('recorded')
		expect(fixture.entries).toHaveLength(2)
	})
})

// ─── Eval ────────────────────────────────────────────────────────

describe('Eval', () => {
	it('evaluates contains criterion', async () => {
		const result = await runEvalSuite({
			name: 'contains-test',
			cases: [
				{
					name: 'has-keyword',
					input: 'What is TypeScript?',
					criteria: [{ type: 'contains', value: 'typed' }],
				},
			],
			runner: async () => 'TypeScript is a typed superset of JavaScript.',
		})

		expect(result.passed).toBe(1)
		expect(result.results[0].passed).toBe(true)
	})

	it('evaluates not_contains criterion', async () => {
		const result = await runEvalSuite({
			name: 'not-contains-test',
			cases: [
				{
					name: 'no-profanity',
					input: 'Tell me about TypeScript',
					criteria: [{ type: 'not_contains', value: 'badword' }],
				},
			],
			runner: async () => 'TypeScript is great!',
		})

		expect(result.passed).toBe(1)
	})

	it('evaluates regex matches criterion', async () => {
		const result = await runEvalSuite({
			name: 'regex-test',
			cases: [
				{
					name: 'has-number',
					input: 'When was TypeScript released?',
					criteria: [{ type: 'matches', pattern: '\\d{4}' }],
				},
			],
			runner: async () => 'TypeScript was released in 2012.',
		})

		expect(result.results[0].passed).toBe(true)
	})

	it('evaluates length criteria', async () => {
		const result = await runEvalSuite({
			name: 'length-test',
			cases: [
				{
					name: 'reasonable-length',
					input: 'What is TypeScript?',
					criteria: [
						{ type: 'length_min', value: 10 },
						{ type: 'length_max', value: 1000 },
					],
				},
			],
			runner: async () => 'TypeScript is a typed superset of JavaScript.',
		})

		expect(result.results[0].passed).toBe(true)
		expect(result.results[0].score).toBe(1)
	})

	it('evaluates json_valid criterion', async () => {
		const result = await runEvalSuite({
			name: 'json-test',
			cases: [
				{
					name: 'valid-json',
					input: 'Return JSON',
					criteria: [{ type: 'json_valid' }],
				},
			],
			runner: async () => '{"name": "Alice", "age": 30}',
		})

		expect(result.results[0].passed).toBe(true)
	})

	it('evaluates json_matches criterion', async () => {
		const result = await runEvalSuite({
			name: 'json-schema-test',
			cases: [
				{
					name: 'matches-schema',
					input: 'Return person',
					criteria: [
						{
							type: 'json_matches',
							schema: { name: 'string', age: 'number' },
						},
					],
				},
			],
			runner: async () => '{"name": "Alice", "age": 30}',
		})

		expect(result.results[0].passed).toBe(true)
	})

	it('evaluates custom criterion', async () => {
		const result = await runEvalSuite({
			name: 'custom-test',
			cases: [
				{
					name: 'custom-check',
					input: 'test',
					criteria: [
						{
							type: 'custom',
							name: 'starts-with-capital',
							fn: (output) => /^[A-Z]/.test(output),
						},
					],
				},
			],
			runner: async () => 'Hello world',
		})

		expect(result.results[0].passed).toBe(true)
	})

	it('checks expected text', async () => {
		const result = await runEvalSuite({
			name: 'expected-test',
			cases: [
				{
					name: 'contains-answer',
					input: 'Capital of France?',
					expected: 'Paris',
				},
			],
			runner: async () => 'The capital of France is Paris.',
		})

		expect(result.results[0].passed).toBe(true)
	})

	it('handles failing cases', async () => {
		const result = await runEvalSuite({
			name: 'fail-test',
			cases: [
				{
					name: 'will-fail',
					input: 'test',
					criteria: [{ type: 'contains', value: 'nonexistent' }],
				},
			],
			runner: async () => 'Something else entirely.',
		})

		expect(result.failed).toBe(1)
		expect(result.results[0].passed).toBe(false)
		expect(result.score).toBe(0)
	})

	it('handles runner errors', async () => {
		const result = await runEvalSuite({
			name: 'error-test',
			cases: [{ name: 'error-case', input: 'test', criteria: [] }],
			runner: async () => {
				throw new Error('runner broke')
			},
		})

		expect(result.results[0].passed).toBe(false)
		expect(result.results[0].criteria[0].message).toContain('runner broke')
	})

	it('runs cases concurrently', async () => {
		const result = await runEvalSuite({
			name: 'concurrent-test',
			concurrency: 3,
			cases: [
				{ name: 'a', input: '1', expected: 'echo: 1' },
				{ name: 'b', input: '2', expected: 'echo: 2' },
				{ name: 'c', input: '3', expected: 'echo: 3' },
			],
			runner: async (input) => `echo: ${input}`,
		})

		expect(result.total).toBe(3)
		expect(result.passed).toBe(3)
	})

	it('calculates overall score', async () => {
		const result = await runEvalSuite({
			name: 'score-test',
			cases: [
				{
					name: 'pass',
					input: 'test',
					criteria: [{ type: 'contains', value: 'hello' }],
				},
				{
					name: 'fail',
					input: 'test',
					criteria: [{ type: 'contains', value: 'missing' }],
				},
			],
			runner: async () => 'hello world',
		})

		expect(result.score).toBe(0.5)
	})

	it('formats eval report', async () => {
		const result = await runEvalSuite({
			name: 'format-test',
			cases: [
				{
					name: 'pass-case',
					input: 'test',
					criteria: [{ type: 'contains', value: 'hello' }],
				},
				{
					name: 'fail-case',
					input: 'test',
					criteria: [{ type: 'contains', value: 'missing' }],
				},
			],
			runner: async () => 'hello world',
		})

		const report = formatEvalReport(result)
		expect(report).toContain('format-test')
		expect(report).toContain('PASS')
		expect(report).toContain('FAIL')
		expect(report).toContain('50.0%')
	})
})

// ─── Snapshots ───────────────────────────────────────────────────

describe('Snapshots', () => {
	it('creates new snapshot', async () => {
		const store = createSnapshotStore()

		const result = await testSnapshot('greeting', store, async () => 'Hello world!')

		expect(result.status).toBe('new')
		expect(result.currentHash).toBeTruthy()
		expect(store.get('greeting')).toBeDefined()
	})

	it('detects matching snapshot', async () => {
		const store = createSnapshotStore()

		await testSnapshot('test', store, async () => 'Same output')
		const result = await testSnapshot('test', store, async () => 'Same output')

		expect(result.status).toBe('match')
	})

	it('detects changed snapshot', async () => {
		const store = createSnapshotStore()

		await testSnapshot('test', store, async () => 'Original output')
		const result = await testSnapshot('test', store, async () => 'Changed output')

		expect(result.status).toBe('changed')
		expect(result.previousHash).toBeTruthy()
		expect(result.previousHash).not.toBe(result.currentHash)
	})

	it('hashes output consistently', () => {
		const h1 = hashOutput('Hello world')
		const h2 = hashOutput('Hello world')
		const h3 = hashOutput('Different text')

		expect(h1).toBe(h2)
		expect(h1).not.toBe(h3)
	})

	it('serializes snapshot store', async () => {
		const store = createSnapshotStore()

		await testSnapshot('a', store, async () => 'output a')
		await testSnapshot('b', store, async () => 'output b')

		const json = store.toJSON()
		const parsed = JSON.parse(json)
		expect(parsed).toHaveLength(2)
	})

	it('loads existing snapshots', () => {
		const store = createSnapshotStore([
			{
				name: 'existing',
				request: { messages: [] },
				outputHash: 'abc123',
				timestamp: new Date().toISOString(),
			},
		])

		expect(store.get('existing')).toBeDefined()
		expect(store.get('existing')?.outputHash).toBe('abc123')
	})
})
