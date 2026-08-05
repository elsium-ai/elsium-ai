import { createEd25519Signer, createKeyRegistry, generateEd25519KeyPair } from '@elsium-ai/core'
import { describe, expect, it } from 'vitest'
import { diffAiBom, passesGate } from './diff'
import { type AiBomInput, generateAiBom, serializeAiBom } from './generate'
import { AIBOM_VERSION, type AiBom } from './types'
import { verifyAiBom } from './verify'

// One key pair for the whole file: a fresh pair per helper call would make
// every signature check fail for the wrong reason, hiding real regressions.
const RELEASE_PAIR = generateEd25519KeyPair()

function setup() {
	const signer = createEd25519Signer({ privateKey: RELEASE_PAIR.privateKey, keyId: 'release-key' })
	const registry = createKeyRegistry({
		trustRoots: [{ keyId: 'release-key', publicKey: RELEASE_PAIR.publicKey }],
	})
	return { signer, registry, pair: RELEASE_PAIR }
}

const BASE_INPUT: AiBomInput = {
	agentId: 'loan-underwriter',
	agentVersion: '2.3.1',
	environment: 'production',
	models: [
		{ provider: 'anthropic', model: 'claude-sonnet-4-6', role: 'primary', region: 'eu-west-1' },
	],
	prompts: [{ name: 'system', version: '7', content: 'You assess loan applications.' }],
	tools: [
		{
			name: 'credit_check',
			description: 'Query the credit bureau',
			rawSchema: { type: 'object', properties: { ssn: { type: 'string' } } },
			sideEffectLevel: 'read',
			sandbox: { mode: 'worker', capabilities: ['network:api.bureau.com'] },
		},
	],
	datasets: [{ name: 'golden-loans', caseCount: 240, contentHash: 'd'.repeat(64) }],
	policies: [{ name: 'lending-policy', version: '3', document: { deny: ['model:gpt-4o'] } }],
	thresholds: { confidenceFloor: 0.8, maxCostUsd: 5 },
}

// Fixed clock + bomId so regenerating the same composition is byte-identical.
const FIXED = { clock: () => 1_754_400_000_000, bomId: 'bom_fixed_1' }

async function bomFrom(input: AiBomInput): Promise<AiBom> {
	const { signer } = setup()
	return generateAiBom(input, { signer, ...FIXED })
}

describe('generateAiBom', () => {
	it('produces a signed BOM covering every component kind', async () => {
		const { signer, registry } = setup()
		const bom = await generateAiBom(BASE_INPUT, { signer, ...FIXED })

		expect(bom.version).toBe(AIBOM_VERSION)
		expect(bom.agentId).toBe('loan-underwriter')
		expect(bom.environment).toBe('production')
		expect(bom.signature.algorithm).toBe('Ed25519')
		expect(bom.components.tools[0].name).toBe('credit_check')
		expect(bom.components.prompts[0].sha256).toMatch(/^[0-9a-f]{64}$/)
		expect(bom.components.policies[0].sha256).toMatch(/^[0-9a-f]{64}$/)
		expect(bom.components.datasets[0].contentSha256).toBe('d'.repeat(64))

		const result = await verifyAiBom(bom, registry)
		expect(result.valid).toBe(true)
	})

	it('is deterministic — same composition, same componentsHash', async () => {
		const first = await bomFrom(BASE_INPUT)
		const second = await bomFrom(BASE_INPUT)
		expect(second.componentsHash).toBe(first.componentsHash)
	})

	it('ignores registration order', async () => {
		const reordered: AiBomInput = {
			...BASE_INPUT,
			tools: [{ name: 'audit_log', rawSchema: { type: 'object' } }, ...(BASE_INPUT.tools ?? [])],
		}
		const forward = await bomFrom(reordered)
		const backward = await bomFrom({
			...reordered,
			tools: [...(reordered.tools ?? [])].reverse(),
		})
		expect(backward.componentsHash).toBe(forward.componentsHash)
	})

	it('hashes prompt content, so an edited prompt changes the BOM', async () => {
		const before = await bomFrom(BASE_INPUT)
		const after = await bomFrom({
			...BASE_INPUT,
			prompts: [
				{ name: 'system', version: '7', content: 'You assess loan applications. Be lenient.' },
			],
		})
		expect(after.componentsHash).not.toBe(before.componentsHash)
	})

	it('accepts a pre-hashed component alongside a raw one', async () => {
		const bom = await bomFrom({
			...BASE_INPUT,
			prompts: [{ name: 'system', version: '7', sha256: 'a'.repeat(64) }],
		})
		expect(bom.components.prompts[0].sha256).toBe('a'.repeat(64))
	})

	it('rejects duplicate component identity', async () => {
		const { signer } = setup()
		await expect(
			generateAiBom(
				{
					agentId: 'dup',
					tools: [
						{ name: 'send_email', rawSchema: {} },
						{ name: 'send_email', rawSchema: { type: 'object' } },
					],
				},
				{ signer },
			),
		).rejects.toThrow(/Duplicate tool "send_email"/)
	})

	it('refuses to generate without an agentId or signer', async () => {
		const { signer } = setup()
		await expect(generateAiBom({ agentId: '' }, { signer })).rejects.toThrow(/agentId/)
		await expect(
			generateAiBom({ agentId: 'x' }, undefined as unknown as { signer: typeof signer }),
		).rejects.toThrow(/signer/)
	})
})

describe('verifyAiBom', () => {
	it('detects a swapped component', async () => {
		const { registry } = setup()
		const bom = await bomFrom(BASE_INPUT)
		const tampered: AiBom = {
			...bom,
			components: {
				...bom.components,
				tools: [{ ...bom.components.tools[0], capabilities: ['network:*'] }],
			},
		}

		const result = await verifyAiBom(tampered, registry)
		expect(result.valid).toBe(false)
		expect(result.componentsHashValid).toBe(false)
		expect(result.reason).toMatch(/componentsHash/)
	})

	it('reports which checks actually ran, so an unevaluated one is not called invalid', async () => {
		const { registry } = setup()
		const bom = await bomFrom(BASE_INPUT)

		const clean = await verifyAiBom(bom, registry)
		expect(clean.checked).toEqual({ componentsHash: true, digest: true, signature: true })

		// Components fail first — digest and signature are never evaluated.
		const swapped = await verifyAiBom(
			{ ...bom, components: { ...bom.components, thresholds: { confidenceFloor: 0.1 } } },
			registry,
		)
		expect(swapped.checked).toEqual({ componentsHash: true, digest: false, signature: false })
		expect(swapped.signatureValid).toBe(false)

		// Header fails second — the signature is still never evaluated.
		const rewritten = await verifyAiBom({ ...bom, agentVersion: '9.9.9' }, registry)
		expect(rewritten.checked).toEqual({ componentsHash: true, digest: true, signature: false })
	})

	it('detects a rewritten header even when components are untouched', async () => {
		const { registry } = setup()
		const bom = await bomFrom(BASE_INPUT)
		const result = await verifyAiBom({ ...bom, environment: 'staging' }, registry)
		expect(result.valid).toBe(false)
		expect(result.componentsHashValid).toBe(true)
		expect(result.digestValid).toBe(false)
	})

	it('rejects a signature from an untrusted key', async () => {
		const bom = await bomFrom(BASE_INPUT)
		const stranger = generateEd25519KeyPair()
		const registry = createKeyRegistry({
			trustRoots: [{ keyId: 'release-key', publicKey: stranger.publicKey }],
		})
		const result = await verifyAiBom(bom, registry)
		expect(result.valid).toBe(false)
		expect(result.signatureValid).toBe(false)
		expect(result.digestValid).toBe(true)
	})

	it('rejects an unknown BOM version', async () => {
		const { registry } = setup()
		const bom = await bomFrom(BASE_INPUT)
		const result = await verifyAiBom(
			{ ...bom, version: 'elsium-aibom/v99' } as unknown as AiBom,
			registry,
		)
		expect(result.valid).toBe(false)
		expect(result.reason).toMatch(/Unsupported AI-BOM version/)
	})
})

describe('diffAiBom', () => {
	it('reports no drift for an unchanged composition', async () => {
		const approved = await bomFrom(BASE_INPUT)
		const current = await bomFrom(BASE_INPUT)
		const diff = diffAiBom(approved, current)
		expect(diff.identical).toBe(true)
		expect(diff.highestSeverity).toBeNull()
		expect(passesGate(diff)).toBe(true)
	})

	it('flags an added tool as critical — the action surface grew', async () => {
		const approved = await bomFrom(BASE_INPUT)
		const current = await bomFrom({
			...BASE_INPUT,
			tools: [...(BASE_INPUT.tools ?? []), { name: 'wire_transfer', rawSchema: {} }],
		})

		const diff = diffAiBom(approved, current)
		const drift = diff.drifts.find((d) => d.id === 'wire_transfer')
		expect(drift).toMatchObject({ kind: 'added', componentKind: 'tool', severity: 'critical' })
		expect(passesGate(diff)).toBe(false)
	})

	it('flags a widened sandbox capability as critical', async () => {
		const approved = await bomFrom(BASE_INPUT)
		const current = await bomFrom({
			...BASE_INPUT,
			tools: [
				{
					...(BASE_INPUT.tools?.[0] as { name: string }),
					rawSchema: { type: 'object', properties: { ssn: { type: 'string' } } },
					sideEffectLevel: 'read',
					sandbox: { mode: 'worker', capabilities: ['network:api.bureau.com', 'network:*'] },
				},
			],
		})

		const diff = diffAiBom(approved, current)
		const drift = diff.drifts.find((d) => d.field === 'capabilities')
		expect(drift?.severity).toBe('critical')
		expect(drift?.reason).toMatch(/network:\*/)
	})

	it('reports a model swap on the same role as a change, not add plus remove', async () => {
		const approved = await bomFrom(BASE_INPUT)
		const current = await bomFrom({
			...BASE_INPUT,
			models: [{ provider: 'openai', model: 'gpt-4o', role: 'primary', region: 'eu-west-1' }],
		})

		const diff = diffAiBom(approved, current)
		const kinds = diff.drifts.filter((d) => d.componentKind === 'model').map((d) => d.kind)
		expect(kinds).not.toContain('added')
		expect(kinds).not.toContain('removed')
		expect(diff.drifts.find((d) => d.field === 'provider')?.severity).toBe('critical')
	})

	it('treats a region move as critical — jurisdiction changed', async () => {
		const approved = await bomFrom(BASE_INPUT)
		const current = await bomFrom({
			...BASE_INPUT,
			models: [
				{ provider: 'anthropic', model: 'claude-sonnet-4-6', role: 'primary', region: 'us-east-1' },
			],
		})
		const drift = diffAiBom(approved, current).drifts.find((d) => d.field === 'region')
		expect(drift?.severity).toBe('critical')
	})

	it('treats a prompt revision as major, not critical', async () => {
		const approved = await bomFrom(BASE_INPUT)
		const current = await bomFrom({
			...BASE_INPUT,
			prompts: [{ name: 'system', version: '8', content: 'You assess loans. Be strict.' }],
		})

		const diff = diffAiBom(approved, current)
		expect(diff.counts.critical).toBe(0)
		expect(diff.counts.major).toBeGreaterThan(0)
		expect(passesGate(diff)).toBe(true)
		expect(passesGate(diff, 'major')).toBe(false)
	})

	it('treats a removed policy as critical — a control disappeared', async () => {
		const approved = await bomFrom(BASE_INPUT)
		const current = await bomFrom({ ...BASE_INPUT, policies: [] })
		const drift = diffAiBom(approved, current).drifts.find((d) => d.componentKind === 'policy')
		expect(drift).toMatchObject({ kind: 'removed', severity: 'critical' })
	})

	it('flags a policy demoted to monitor-only', async () => {
		const approved = await bomFrom({
			...BASE_INPUT,
			policies: [{ name: 'lending-policy', sha256: 'c'.repeat(64), mode: 'enforce' }],
		})
		const current = await bomFrom({
			...BASE_INPUT,
			policies: [{ name: 'lending-policy', sha256: 'c'.repeat(64), mode: 'monitor' }],
		})
		const drift = diffAiBom(approved, current).drifts.find((d) => d.field === 'mode')
		expect(drift?.severity).toBe('critical')
	})

	it('flags a retuned threshold as major', async () => {
		const approved = await bomFrom(BASE_INPUT)
		const current = await bomFrom({
			...BASE_INPUT,
			thresholds: { confidenceFloor: 0.2, maxCostUsd: 5 },
		})
		const drift = diffAiBom(approved, current).drifts.find((d) => d.id === 'confidenceFloor')
		expect(drift).toMatchObject({ kind: 'changed', severity: 'major' })
		expect(drift?.reason).toMatch(/0\.8 → 0\.2/)
	})

	it('keeps a framework version bump at minor', async () => {
		const approved = await bomFrom({
			...BASE_INPUT,
			runtime: { framework: 'elsium-ai', frameworkVersion: '0.18.0' },
		})
		const current = await bomFrom({
			...BASE_INPUT,
			runtime: { framework: 'elsium-ai', frameworkVersion: '0.19.0' },
		})
		const diff = diffAiBom(approved, current)
		expect(diff.highestSeverity).toBe('minor')
		expect(passesGate(diff, 'major')).toBe(true)
	})

	it('ranks the worst drift when several land at once', async () => {
		const approved = await bomFrom(BASE_INPUT)
		const current = await bomFrom({
			...BASE_INPUT,
			prompts: [{ name: 'system', version: '8', content: 'Different.' }],
			tools: [...(BASE_INPUT.tools ?? []), { name: 'wire_transfer', rawSchema: {} }],
			runtime: { frameworkVersion: '0.19.0' },
		})

		const diff = diffAiBom(approved, current)
		expect(diff.highestSeverity).toBe('critical')
		expect(diff.counts.critical).toBeGreaterThan(0)
		expect(diff.counts.major).toBeGreaterThan(0)
		expect(diff.counts.minor).toBeGreaterThan(0)
	})
})

describe('serializeAiBom', () => {
	it('round-trips through JSON and still verifies', async () => {
		const { registry } = setup()
		const bom = await bomFrom(BASE_INPUT)
		const restored = JSON.parse(serializeAiBom(bom)) as AiBom
		expect((await verifyAiBom(restored, registry)).valid).toBe(true)
	})

	it('emits stable bytes regardless of key insertion order', async () => {
		const bom = await bomFrom(BASE_INPUT)
		const shuffled = {
			signature: bom.signature,
			agentId: bom.agentId,
			components: bom.components,
			version: bom.version,
			digest: bom.digest,
			bomId: bom.bomId,
			componentsHash: bom.componentsHash,
			generatedAt: bom.generatedAt,
			agentVersion: bom.agentVersion,
			environment: bom.environment,
		} as AiBom
		expect(serializeAiBom(shuffled)).toBe(serializeAiBom(bom))
	})
})
