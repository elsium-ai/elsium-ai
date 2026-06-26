import { describe, expect, it } from 'vitest'
import {
	type EvalAttestation,
	attestEvalSuite,
	formatAttestation,
	verifyEvalAttestation,
} from './attestation'
import { runEvalSuite } from './eval'

const SECRET = 'super-secret-attestation-key'

async function sampleSuite() {
	return runEvalSuite({
		name: 'claims triage',
		cases: [
			{
				name: 'approve',
				input: 'valid policy',
				criteria: [{ type: 'contains', value: 'APPROVE' }],
			},
			{ name: 'deny', input: 'fraud', criteria: [{ type: 'contains', value: 'APPROVE' }] },
		],
		runner: async (input) => (input === 'fraud' ? 'DENY' : 'APPROVE'),
	})
}

describe('attestEvalSuite / verifyEvalAttestation', () => {
	it('produces a verifiable hash-chained attestation', async () => {
		const att = await attestEvalSuite(await sampleSuite(), {
			secret: SECRET,
			metadata: { model: 'claude-opus-4-8', seed: 7 },
			attestedAt: 1000,
		})
		expect(att.apiVersion).toBe('elsium.eval-attestation/v1')
		expect(att.entries).toHaveLength(2)
		expect(att.summary.total).toBe(2)
		const verdict = await verifyEvalAttestation(att, SECRET)
		expect(verdict.valid).toBe(true)
		expect(verdict.entryCount).toBe(2)
	})

	it('stores only hashes, never raw input/output', async () => {
		const att = await attestEvalSuite(await sampleSuite(), { secret: SECRET })
		const serialized = JSON.stringify(att)
		expect(serialized).not.toContain('fraud')
		expect(serialized).not.toContain('DENY')
		expect(att.entries[0].record.inputHash).toMatch(/^[0-9a-f]{64}$/)
		expect(att.entries[0].record.outputHash).toMatch(/^[0-9a-f]{64}$/)
	})

	it('round-trips through JSON', async () => {
		const att = await attestEvalSuite(await sampleSuite(), { secret: SECRET, attestedAt: 1 })
		const verdict = await verifyEvalAttestation(JSON.stringify(att), SECRET)
		expect(verdict.valid).toBe(true)
	})

	it('detects a tampered record', async () => {
		const att = await attestEvalSuite(await sampleSuite(), { secret: SECRET, attestedAt: 1 })
		const tampered: EvalAttestation = {
			...att,
			entries: att.entries.map((e, i) =>
				i === 1 ? { ...e, record: { ...e.record, passed: !e.record.passed } } : e,
			),
		}
		const verdict = await verifyEvalAttestation(tampered, SECRET)
		expect(verdict.valid).toBe(false)
		expect(verdict.invalidAtIndex).toBe(1)
		expect(verdict.reason).toContain('tampered')
	})

	it('detects a tampered header via genesis mismatch', async () => {
		const att = await attestEvalSuite(await sampleSuite(), {
			secret: SECRET,
			metadata: { model: 'a' },
			attestedAt: 1,
		})
		const tampered: EvalAttestation = { ...att, metadata: { model: 'b' } }
		const verdict = await verifyEvalAttestation(tampered, SECRET)
		expect(verdict.valid).toBe(false)
		expect(verdict.invalidAtIndex).toBe(0)
		expect(verdict.reason).toContain('genesis')
	})

	it('fails verification with the wrong secret', async () => {
		const att = await attestEvalSuite(await sampleSuite(), { secret: SECRET, attestedAt: 1 })
		const verdict = await verifyEvalAttestation(att, 'a-different-secret-key-16')
		expect(verdict.valid).toBe(false)
	})

	it('binds embedded governance into the chain', async () => {
		const suite = await sampleSuite()
		const att = await attestEvalSuite(suite, {
			secret: SECRET,
			attestedAt: 1,
			governance: { gate: 'pii-gate', passed: false, violationCount: 1 },
		})
		expect(await verifyEvalAttestation(att, SECRET)).toMatchObject({ valid: true })
		const swapped: EvalAttestation = {
			...att,
			governance: { gate: 'pii-gate', passed: true, violationCount: 0 },
		}
		expect((await verifyEvalAttestation(swapped, SECRET)).valid).toBe(false)
	})

	it('rejects weak secrets and bad envelopes', async () => {
		await expect(attestEvalSuite(await sampleSuite(), { secret: 'short' })).rejects.toThrow()
		expect((await verifyEvalAttestation('not json', SECRET)).reason).toContain('Invalid JSON')
		const att = await attestEvalSuite(await sampleSuite(), { secret: SECRET, attestedAt: 1 })
		const badVersion = { ...att, apiVersion: 'nope' } as unknown as EvalAttestation
		expect((await verifyEvalAttestation(badVersion, SECRET)).reason).toContain('apiVersion')
	})

	it('formats a readable attestation summary', async () => {
		const att = await attestEvalSuite(await sampleSuite(), {
			secret: SECRET,
			governance: {
				gate: 'pii-gate',
				passed: false,
				violationCount: 1,
				override: { approver: 'eric', reason: 'accepted risk' },
			},
		})
		const text = formatAttestation(att)
		expect(text).toContain('Eval Attestation')
		expect(text).toContain('hash-chained')
		expect(text).toContain('overridden by eric')
	})
})
