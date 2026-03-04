import { describe, expect, it, vi } from 'vitest'
import { createSnapshotStore, hashOutput, testSnapshot } from './snapshot'
import type { PromptSnapshot } from './snapshot'

// ─── Helpers ─────────────────────────────────────────────────────

function makeSnapshot(name: string, hash = 'abc123'): PromptSnapshot {
	return {
		name,
		request: { messages: [{ role: 'user', content: 'Hello' }] },
		outputHash: hash,
		timestamp: new Date().toISOString(),
	}
}

// ─── hashOutput ───────────────────────────────────────────────────

describe('hashOutput', () => {
	it('returns a hex string', () => {
		const hash = hashOutput('hello')
		expect(hash).toMatch(/^[0-9a-f]+$/)
	})

	it('produces the same hash for identical input', () => {
		const h1 = hashOutput('deterministic content')
		const h2 = hashOutput('deterministic content')
		expect(h1).toBe(h2)
	})

	it('produces different hashes for different input', () => {
		const h1 = hashOutput('foo')
		const h2 = hashOutput('bar')
		expect(h1).not.toBe(h2)
	})

	it('returns a 64-character SHA-256 hex string', () => {
		const hash = hashOutput('some content')
		expect(hash).toHaveLength(64)
	})

	it('is sensitive to whitespace differences', () => {
		expect(hashOutput('hello world')).not.toBe(hashOutput('helloworld'))
		expect(hashOutput('hello\n')).not.toBe(hashOutput('hello'))
	})

	it('handles empty string', () => {
		const hash = hashOutput('')
		expect(hash).toHaveLength(64)
		expect(typeof hash).toBe('string')
	})

	it('handles unicode content', () => {
		const hash = hashOutput('Héllo wörld 🌍')
		expect(hash).toHaveLength(64)
	})
})

// ─── createSnapshotStore ──────────────────────────────────────────

describe('createSnapshotStore — initialisation', () => {
	it('starts empty when no existing snapshots provided', () => {
		const store = createSnapshotStore()
		expect(store.getAll()).toHaveLength(0)
	})

	it('loads provided existing snapshots', () => {
		const existing = [makeSnapshot('test-1', 'hash1'), makeSnapshot('test-2', 'hash2')]
		const store = createSnapshotStore(existing)

		expect(store.getAll()).toHaveLength(2)
	})

	it('allows retrieval of loaded snapshots by name', () => {
		const snap = makeSnapshot('my-test')
		const store = createSnapshotStore([snap])

		expect(store.get('my-test')).toEqual(snap)
	})

	it('returns undefined for unknown snapshot name', () => {
		const store = createSnapshotStore()
		expect(store.get('nonexistent')).toBeUndefined()
	})
})

describe('createSnapshotStore — get / set', () => {
	it('stores and retrieves a snapshot by name', () => {
		const store = createSnapshotStore()
		const snap = makeSnapshot('greeting')

		store.set('greeting', snap)

		expect(store.get('greeting')).toEqual(snap)
	})

	it('overwrites an existing snapshot when set is called with the same name', () => {
		const store = createSnapshotStore()
		store.set('key', makeSnapshot('key', 'old-hash'))
		store.set('key', makeSnapshot('key', 'new-hash'))

		expect(store.get('key')?.outputHash).toBe('new-hash')
	})

	it('stores multiple distinct snapshots', () => {
		const store = createSnapshotStore()
		store.set('a', makeSnapshot('a', 'h1'))
		store.set('b', makeSnapshot('b', 'h2'))

		expect(store.get('a')?.outputHash).toBe('h1')
		expect(store.get('b')?.outputHash).toBe('h2')
	})
})

describe('createSnapshotStore — getAll', () => {
	it('returns all stored snapshots', () => {
		const store = createSnapshotStore()
		store.set('x', makeSnapshot('x'))
		store.set('y', makeSnapshot('y'))

		expect(store.getAll()).toHaveLength(2)
	})

	it('returns empty array when store is empty', () => {
		expect(createSnapshotStore().getAll()).toEqual([])
	})
})

describe('createSnapshotStore — toJSON', () => {
	it('serialises all snapshots as a JSON array', () => {
		const store = createSnapshotStore()
		store.set('snap1', makeSnapshot('snap1', 'h1'))
		store.set('snap2', makeSnapshot('snap2', 'h2'))

		const parsed = JSON.parse(store.toJSON())

		expect(Array.isArray(parsed)).toBe(true)
		expect(parsed).toHaveLength(2)
	})

	it('returns "[]" when store is empty', () => {
		const store = createSnapshotStore()
		expect(JSON.parse(store.toJSON())).toEqual([])
	})

	it('round-trips through JSON without losing data', () => {
		const original = makeSnapshot('round-trip', 'deadbeef')
		const store = createSnapshotStore([original])

		const parsed: PromptSnapshot[] = JSON.parse(store.toJSON())
		const reloaded = createSnapshotStore(parsed)

		expect(reloaded.get('round-trip')?.outputHash).toBe('deadbeef')
	})
})

// ─── testSnapshot ─────────────────────────────────────────────────

describe('testSnapshot — new snapshot', () => {
	it('returns status "new" when snapshot does not exist yet', async () => {
		const store = createSnapshotStore()
		const result = await testSnapshot('first-run', store, async () => 'output text')

		expect(result.status).toBe('new')
	})

	it('stores the snapshot in the store after first run', async () => {
		const store = createSnapshotStore()
		await testSnapshot('first-run', store, async () => 'some output')

		expect(store.get('first-run')).toBeDefined()
	})

	it('includes the output in the result', async () => {
		const store = createSnapshotStore()
		const result = await testSnapshot('test', store, async () => 'my output')

		expect(result.output).toBe('my output')
	})

	it('includes a non-empty currentHash', async () => {
		const store = createSnapshotStore()
		const result = await testSnapshot('test', store, async () => 'content')

		expect(result.currentHash).toHaveLength(64)
	})

	it('does not set previousHash on new snapshot', async () => {
		const store = createSnapshotStore()
		const result = await testSnapshot('test', store, async () => 'content')

		expect(result.previousHash).toBeUndefined()
	})
})

describe('testSnapshot — matching snapshot', () => {
	it('returns status "match" when output is identical to stored hash', async () => {
		const store = createSnapshotStore()

		await testSnapshot('stable', store, async () => 'Same output every time')
		const result = await testSnapshot('stable', store, async () => 'Same output every time')

		expect(result.status).toBe('match')
	})

	it('includes the previousHash equal to currentHash on match', async () => {
		const store = createSnapshotStore()
		const runner = async () => 'unchanging output'

		await testSnapshot('check', store, runner)
		const result = await testSnapshot('check', store, runner)

		expect(result.previousHash).toBe(result.currentHash)
	})

	it('does not update the stored snapshot on match', async () => {
		const store = createSnapshotStore()

		await testSnapshot('stable', store, async () => 'output')
		const first = store.get('stable')

		await testSnapshot('stable', store, async () => 'output')
		const second = store.get('stable')

		// Timestamps differ between runs, so we compare just the hash
		expect(first?.outputHash).toBe(second?.outputHash)
	})
})

describe('testSnapshot — changed snapshot', () => {
	it('returns status "changed" when output differs from stored hash', async () => {
		const store = createSnapshotStore()

		await testSnapshot('volatile', store, async () => 'original')
		const result = await testSnapshot('volatile', store, async () => 'different output')

		expect(result.status).toBe('changed')
	})

	it('includes both previousHash and currentHash on change', async () => {
		const store = createSnapshotStore()

		await testSnapshot('tracked', store, async () => 'v1')
		const result = await testSnapshot('tracked', store, async () => 'v2')

		expect(result.previousHash).toBeDefined()
		expect(result.currentHash).toBeDefined()
		expect(result.previousHash).not.toBe(result.currentHash)
	})

	it('updates the stored snapshot after a change', async () => {
		const store = createSnapshotStore()

		await testSnapshot('changing', store, async () => 'first')
		const afterFirst = store.get('changing')?.outputHash

		await testSnapshot('changing', store, async () => 'second')
		const afterSecond = store.get('changing')?.outputHash

		expect(afterFirst).not.toBe(afterSecond)
	})

	it('outputs the new content in result.output', async () => {
		const store = createSnapshotStore()

		await testSnapshot('test', store, async () => 'old')
		const result = await testSnapshot('test', store, async () => 'brand new content')

		expect(result.output).toBe('brand new content')
	})
})

describe('testSnapshot — request metadata', () => {
	it('saves request system prompt in stored snapshot', async () => {
		const store = createSnapshotStore()
		await testSnapshot('with-request', store, async () => 'output', {
			system: 'You are helpful.',
			messages: [{ role: 'user', content: 'Hello' }],
		})

		const snap = store.get('with-request')
		expect(snap?.request.system).toBe('You are helpful.')
	})

	it('saves request model in stored snapshot', async () => {
		const store = createSnapshotStore()
		await testSnapshot('with-model', store, async () => 'output', { messages: [], model: 'gpt-4o' })

		const snap = store.get('with-model')
		expect(snap?.request.model).toBe('gpt-4o')
	})

	it('converts complex message content to "[complex]" placeholder', async () => {
		const store = createSnapshotStore()
		await testSnapshot('complex-content', store, async () => 'output', {
			messages: [
				{
					role: 'user',
					content: [{ type: 'text', text: 'nested' }],
				},
			],
		})

		const snap = store.get('complex-content')
		expect(snap?.request.messages[0].content).toBe('[complex]')
	})

	it('stores an empty messages array when no request is provided', async () => {
		const store = createSnapshotStore()
		await testSnapshot('no-request', store, async () => 'output')

		const snap = store.get('no-request')
		expect(snap?.request.messages).toEqual([])
	})
})

describe('testSnapshot — runner integration', () => {
	it('calls the runner exactly once', async () => {
		const store = createSnapshotStore()
		const runner = vi.fn().mockResolvedValue('result')

		await testSnapshot('once', store, runner)

		expect(runner).toHaveBeenCalledOnce()
	})

	it('propagates runner errors', async () => {
		const store = createSnapshotStore()
		const runner = vi.fn().mockRejectedValue(new Error('runner exploded'))

		await expect(testSnapshot('error', store, runner)).rejects.toThrow('runner exploded')
	})

	it('does not store snapshot when runner throws', async () => {
		const store = createSnapshotStore()
		const runner = vi.fn().mockRejectedValue(new Error('fail'))

		try {
			await testSnapshot('failed', store, runner)
		} catch {
			// expected
		}

		expect(store.get('failed')).toBeUndefined()
	})
})
