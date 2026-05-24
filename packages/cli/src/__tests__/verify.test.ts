import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEd25519Signer, createKeyRegistry, generateEd25519KeyPair } from '@elsium-ai/core'
import { createProofRecorder } from '@elsium-ai/observe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { replayCommand } from '../commands/replay'
import { verifyCommand } from '../commands/verify'

function captureConsole() {
	const logs: string[] = []
	const errors: string[] = []
	const origLog = console.log
	const origError = console.error
	console.log = (...args: unknown[]) => logs.push(args.join(' '))
	console.error = (...args: unknown[]) => errors.push(args.join(' '))
	return {
		logs,
		errors,
		restore() {
			console.log = origLog
			console.error = origError
		},
	}
}

interface ExitCalled extends Error {
	code: number
}

function captureExit() {
	const calls: number[] = []
	const spy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
		const n = code ?? 0
		calls.push(n)
		const err = new Error(`__exit:${n}`) as ExitCalled
		err.code = n
		throw err
	}) as never)
	return { calls, spy }
}

async function makeProofFiles(dir: string) {
	const pair = generateEd25519KeyPair()
	const signer = createEd25519Signer({ privateKey: pair.privateKey, keyId: 'k1' })
	const recorder = createProofRecorder({ signer })

	const sessGood = recorder.startSession({ agentId: 'a', clock: () => 1000 })
	sessGood.recordToolCall({ tool: 't', inputHash: 'x', outputHash: 'y' })
	const proofGood = await sessGood.finalize()
	const goodPath = join(dir, 'good.json')
	writeFileSync(goodPath, JSON.stringify(proofGood))

	const sessTampered = recorder.startSession({ agentId: 'a', clock: () => 1000 })
	sessTampered.recordToolCall({ tool: 't', inputHash: 'x', outputHash: 'y' })
	const proofTampered = await sessTampered.finalize()
	const t = JSON.parse(JSON.stringify(proofTampered))
	t.events[0].data.outputHash = 'mutated'
	const tamperedPath = join(dir, 'tampered.json')
	writeFileSync(tamperedPath, JSON.stringify(t))

	const pubPath = join(dir, 'org.pub')
	writeFileSync(pubPath, pair.publicKey)

	const trustRoots = JSON.stringify([{ keyId: 'k1', publicKey: pair.publicKey, label: 'main' }])
	const trustPath = join(dir, 'trust-roots.json')
	writeFileSync(trustPath, trustRoots)

	return { goodPath, tamperedPath, pubPath, trustPath, publicKey: pair.publicKey }
}

describe('verifyCommand', () => {
	let dir: string

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'elsium-verify-cli-'))
	})

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true })
		vi.restoreAllMocks()
	})

	it('exits 0 when proof is valid (--public-key from file)', async () => {
		const { goodPath, pubPath } = await makeProofFiles(dir)
		const out = captureConsole()
		const exit = captureExit()
		try {
			await expect(verifyCommand([goodPath, '--public-key', pubPath])).rejects.toThrow(/__exit:0/)
		} finally {
			out.restore()
		}
		expect(exit.calls).toEqual([0])
		expect(out.logs.join('\n')).toContain('Signature valid')
		expect(out.logs.join('\n')).toContain('Hash chain intact')
	})

	it('exits 0 with --trust-roots file', async () => {
		const { goodPath, trustPath } = await makeProofFiles(dir)
		const out = captureConsole()
		const exit = captureExit()
		try {
			await expect(verifyCommand([goodPath, '--trust-roots', trustPath])).rejects.toThrow(
				/__exit:0/,
			)
		} finally {
			out.restore()
		}
		expect(exit.calls).toEqual([0])
	})

	it('exits 1 when the chain is tampered', async () => {
		const { tamperedPath, pubPath } = await makeProofFiles(dir)
		const out = captureConsole()
		const exit = captureExit()
		try {
			await expect(verifyCommand([tamperedPath, '--public-key', pubPath])).rejects.toThrow(
				/__exit:1/,
			)
		} finally {
			out.restore()
		}
		expect(exit.calls).toEqual([1])
		const output = out.logs.join('\n')
		expect(output).toContain('BROKEN')
		expect(output).toContain('broken at event index 0')
	})

	it('emits JSON output with --json', async () => {
		const { goodPath, pubPath } = await makeProofFiles(dir)
		const out = captureConsole()
		const exit = captureExit()
		try {
			await expect(verifyCommand([goodPath, '--public-key', pubPath, '--json'])).rejects.toThrow(
				/__exit:0/,
			)
		} finally {
			out.restore()
		}
		const parsed = JSON.parse(out.logs[0])
		expect(parsed.valid).toBe(true)
		expect(parsed.signatureValid).toBe(true)
		expect(parsed.chainValid).toBe(true)
		expect(parsed.eventCount).toBe(1)
		expect(parsed.events['tool.call']).toBe(1)
		expect(exit.calls).toEqual([0])
	})

	it('exits 1 with usage when no proof path given', async () => {
		const out = captureConsole()
		const exit = captureExit()
		try {
			await expect(verifyCommand([])).rejects.toThrow(/__exit:1/)
		} finally {
			out.restore()
		}
		expect(out.logs.join('\n')).toContain('Usage:')
		expect(exit.calls).toEqual([1])
	})

	it('errors when --public-key and --trust-roots both absent', async () => {
		const { goodPath } = await makeProofFiles(dir)
		const out = captureConsole()
		const exit = captureExit()
		try {
			await expect(verifyCommand([goodPath])).rejects.toThrow(/__exit:1/)
		} finally {
			out.restore()
		}
		expect(out.errors.join('\n')).toContain('--public-key or --trust-roots')
	})

	it('accepts inline PEM string with --public-key', async () => {
		const { goodPath, publicKey } = await makeProofFiles(dir)
		const out = captureConsole()
		const exit = captureExit()
		try {
			await expect(verifyCommand([goodPath, '--public-key', publicKey])).rejects.toThrow(/__exit:0/)
		} finally {
			out.restore()
		}
		expect(exit.calls).toEqual([0])
	})

	it('verifyProof returns the right outcome standalone (sanity)', async () => {
		const { goodPath, publicKey } = await makeProofFiles(dir)
		const registry = createKeyRegistry({
			trustRoots: [{ keyId: 'k1', publicKey, label: 'main' }],
		})
		const { verifyProof } = await import('@elsium-ai/observe')
		const proof = JSON.parse(require('node:fs').readFileSync(goodPath, 'utf8'))
		const result = verifyProof(proof, registry)
		expect(result.valid).toBe(true)
	})
})

describe('replayCommand', () => {
	let dir: string

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'elsium-replay-cli-'))
	})

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true })
		vi.restoreAllMocks()
	})

	async function twoProofs(opts?: { differ?: boolean }) {
		const pair = generateEd25519KeyPair()
		const signer = createEd25519Signer({ privateKey: pair.privateKey, keyId: 'k1' })
		const recorder = createProofRecorder({ signer })

		const a = recorder.startSession({ agentId: 'agent', clock: () => 1000 })
		a.recordLLMCall({ model: 'claude-sonnet-4-6', requestHash: 'r', responseHash: 'a' })
		const proofA = await a.finalize()
		const aPath = join(dir, 'a.json')
		writeFileSync(aPath, JSON.stringify(proofA))

		const b = recorder.startSession({ agentId: 'agent', clock: () => 1000 })
		b.recordLLMCall({
			model: opts?.differ ? 'gpt-4o' : 'claude-sonnet-4-6',
			requestHash: 'r',
			responseHash: 'b',
		})
		const proofB = await b.finalize()
		const bPath = join(dir, 'b.json')
		writeFileSync(bPath, JSON.stringify(proofB))

		return { aPath, bPath }
	}

	it('exits 0 when proofs match structurally (default strategy)', async () => {
		const { aPath, bPath } = await twoProofs()
		const out = captureConsole()
		const exit = captureExit()
		try {
			await expect(replayCommand([aPath, bPath])).rejects.toThrow(/__exit:0/)
		} finally {
			out.restore()
		}
		expect(exit.calls).toEqual([0])
		expect(out.logs.join('\n')).toContain('Strategy: structural')
		expect(out.logs.join('\n')).toContain('Match: YES')
	})

	it('exits 1 when llm.call model differs', async () => {
		const { aPath, bPath } = await twoProofs({ differ: true })
		const out = captureConsole()
		const exit = captureExit()
		try {
			await expect(replayCommand([aPath, bPath])).rejects.toThrow(/__exit:1/)
		} finally {
			out.restore()
		}
		expect(exit.calls).toEqual([1])
		expect(out.logs.join('\n')).toContain('Match: NO')
		expect(out.logs.join('\n')).toContain('data-mismatch')
	})

	it('honors --strategy bit-exact', async () => {
		const { aPath, bPath } = await twoProofs()
		const out = captureConsole()
		const exit = captureExit()
		try {
			await expect(replayCommand([aPath, bPath, '--strategy', 'bit-exact'])).rejects.toThrow(
				/__exit:1/,
			)
		} finally {
			out.restore()
		}
		expect(out.logs.join('\n')).toContain('Strategy: bit-exact')
	})

	it('emits JSON with --json', async () => {
		const { aPath, bPath } = await twoProofs()
		const out = captureConsole()
		const exit = captureExit()
		try {
			await expect(replayCommand([aPath, bPath, '--json'])).rejects.toThrow(/__exit:0/)
		} finally {
			out.restore()
		}
		const parsed = JSON.parse(out.logs[0])
		expect(parsed.matches).toBe(true)
		expect(parsed.strategy).toBe('structural')
	})

	it('rejects invalid --strategy value', async () => {
		const { aPath, bPath } = await twoProofs()
		const out = captureConsole()
		captureExit()
		try {
			await expect(replayCommand([aPath, bPath, '--strategy', 'fuzzy'])).rejects.toThrow(
				/Invalid --strategy/,
			)
		} finally {
			out.restore()
		}
	})

	it('exits 1 with usage when given fewer than 2 proofs', async () => {
		const out = captureConsole()
		const exit = captureExit()
		try {
			await expect(replayCommand(['./only-one.json'])).rejects.toThrow(/__exit:1/)
		} finally {
			out.restore()
		}
		expect(out.logs.join('\n')).toContain('Usage:')
		expect(exit.calls).toEqual([1])
	})
})
