import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
	composeValidators,
	externalValidator,
	regexValidator,
	runWithVerification,
	semanticAdapter,
	zodValidator,
} from './index'
import type {
	GenerateFn,
	RepairContext,
	ValidationContext,
	ValidationOutcome,
	Validator,
} from './types'

function makeGenerate<T>(outputs: T[]): {
	fn: GenerateFn<T>
	repairsSeen: (RepairContext | undefined)[]
} {
	const repairsSeen: (RepairContext | undefined)[] = []
	let i = 0
	const fn: GenerateFn<T> = async (repair) => {
		repairsSeen.push(repair)
		const value = outputs[Math.min(i, outputs.length - 1)]
		i++
		return value
	}
	return { fn, repairsSeen }
}

describe('zodValidator', () => {
	const schema = z.object({ name: z.string(), age: z.number().int().positive() })

	it('passes a valid object', async () => {
		const v = zodValidator(schema)
		const out = await v.validate({ name: 'Ana', age: 30 }, { attempt: 0, previousFailures: [] })
		expect(out.valid).toBe(true)
	})

	it('flags failures with path + repair hint', async () => {
		const v = zodValidator(schema)
		const out = await v.validate({ name: 'Ana', age: -1 }, { attempt: 0, previousFailures: [] })
		expect(out.valid).toBe(false)
		expect(out.failures[0].detail?.path).toEqual(['age'])
		expect(out.failures[0].repairHint).toContain('age')
	})
})

describe('regexValidator', () => {
	it('must-match passes when pattern matches', async () => {
		const v = regexValidator(/^\d+$/)
		expect((await v.validate('12345', { attempt: 0, previousFailures: [] })).valid).toBe(true)
	})

	it('must-match fails when pattern does not match', async () => {
		const v = regexValidator(/^\d+$/)
		const out = await v.validate('abc', { attempt: 0, previousFailures: [] })
		expect(out.valid).toBe(false)
		expect(out.failures[0].repairHint).toContain('must satisfy pattern')
	})

	it('must-not-match fails when forbidden pattern appears', async () => {
		const v = regexValidator(/SECRET/, { mode: 'must-not-match' })
		const out = await v.validate('contains SECRET token', { attempt: 0, previousFailures: [] })
		expect(out.valid).toBe(false)
		expect(out.failures[0].repairHint).toContain('must NOT contain')
	})
})

describe('externalValidator', () => {
	it('reports a failure when the external check returns invalid', async () => {
		const v = externalValidator(
			async (value: { url: string }) => ({
				valid: value.url.startsWith('https://'),
				reason: 'url must be https',
			}),
			{ name: 'https-only', repairHint: 'Use an https URL.' },
		)
		const out = await v.validate({ url: 'http://x.com' }, { attempt: 0, previousFailures: [] })
		expect(out.valid).toBe(false)
		expect(out.failures[0].validator).toBe('https-only')
		expect(out.failures[0].repairHint).toBe('Use an https URL.')
	})
})

describe('semanticAdapter', () => {
	it('passes when underlying SemanticValidator says valid', async () => {
		const sv = {
			async validate() {
				return { valid: true, checks: [{ name: 'rel', passed: true, score: 0.9, reason: 'ok' }] }
			},
			async checkHallucination() {
				return { passed: true, score: 1, reason: '' }
			},
			async checkRelevance() {
				return { passed: true, score: 1, reason: '' }
			},
			async checkGrounding() {
				return { passed: true, score: 1, reason: '' }
			},
		}
		const v = semanticAdapter(sv, { input: 'What is X?' })
		expect((await v.validate('X is foo.', { attempt: 0, previousFailures: [] })).valid).toBe(true)
	})

	it('reports failures with score below threshold', async () => {
		const sv = {
			async validate() {
				return {
					valid: false,
					checks: [
						{ name: 'hallucination', passed: false, score: 0.2, reason: 'made-up fact X' },
						{ name: 'relevance', passed: true, score: 0.9, reason: '' },
					],
				}
			},
			async checkHallucination() {
				return { passed: false, score: 0.2, reason: 'made-up fact X' }
			},
			async checkRelevance() {
				return { passed: true, score: 0.9, reason: '' }
			},
			async checkGrounding() {
				return { passed: true, score: 1, reason: '' }
			},
		}
		const v = semanticAdapter(sv, { input: 'q' })
		const out = await v.validate('answer', { attempt: 0, previousFailures: [] })
		expect(out.valid).toBe(false)
		expect(out.failures[0].validator).toBe('semantic:hallucination')
		expect(out.failures[0].repairHint).toContain('hallucination')
	})
})

describe('composeValidators', () => {
	const passing: Validator<string> = {
		name: 'pass',
		validate: () => ({ valid: true, failures: [] }),
	}
	const failingA: Validator<string> = {
		name: 'fa',
		validate: () => ({ valid: false, failures: [{ validator: 'fa', reason: 'A fail' }] }),
	}
	const failingB: Validator<string> = {
		name: 'fb',
		validate: () => ({ valid: false, failures: [{ validator: 'fb', reason: 'B fail' }] }),
	}

	it('mode=all collects every failure', async () => {
		const composed = composeValidators([failingA, failingB], { mode: 'all' })
		const out = await composed.validate('x', { attempt: 0, previousFailures: [] })
		expect(out.failures).toHaveLength(2)
	})

	it('mode=short-circuit stops at first failure', async () => {
		const composed = composeValidators([failingA, failingB], { mode: 'short-circuit' })
		const out = await composed.validate('x', { attempt: 0, previousFailures: [] })
		expect(out.failures).toHaveLength(1)
		expect(out.failures[0].reason).toBe('A fail')
	})

	it('returns valid when every validator passes', async () => {
		const composed = composeValidators([passing, passing])
		expect((await composed.validate('x', { attempt: 0, previousFailures: [] })).valid).toBe(true)
	})
})

describe('runWithVerification — repair loop', () => {
	const schema = z.object({ name: z.string(), age: z.number().int().positive() })

	it('returns status=ok when the first attempt validates', async () => {
		const { fn, repairsSeen } = makeGenerate([{ name: 'Ana', age: 30 }])
		const outcome = await runWithVerification(fn, { validators: [zodValidator(schema)] })
		expect(outcome.status).toBe('ok')
		expect(outcome.attempts).toBe(1)
		expect(repairsSeen).toEqual([undefined])
	})

	it('returns status=repaired after a successful retry', async () => {
		const { fn, repairsSeen } = makeGenerate([
			{ name: 'Ana', age: -1 },
			{ name: 'Ana', age: 30 },
		])
		const outcome = await runWithVerification(fn, { validators: [zodValidator(schema)] })
		expect(outcome.status).toBe('repaired')
		expect(outcome.attempts).toBe(2)
		expect(repairsSeen[0]).toBeUndefined()
		expect(repairsSeen[1]?.repairPrompt).toContain('age')
		expect(repairsSeen[1]?.failures[0].reason.length).toBeGreaterThan(0)
	})

	it('injects the previous value into the repair prompt', async () => {
		const { fn, repairsSeen } = makeGenerate([
			'invalid json',
			JSON.stringify({ name: 'Ok', age: 1 }),
		])
		await runWithVerification(fn, {
			validators: [regexValidator(/^\{.*\}$/, { name: 'json-shape' })],
		})
		expect(repairsSeen[1]?.repairPrompt).toContain('Previous output')
	})

	it('aborts after maxRepairs', async () => {
		const outputs = [
			{ name: 'Ana', age: -1 },
			{ name: 'Ana', age: -2 },
			{ name: 'Ana', age: -3 },
		]
		const { fn } = makeGenerate(outputs)
		const aborts: unknown[] = []
		const outcome = await runWithVerification(fn, {
			validators: [zodValidator(schema)],
			maxRepairs: 1,
			onAbort: (a) => aborts.push(a),
		})
		expect(outcome.status).toBe('aborted')
		if (outcome.status === 'aborted') {
			expect(outcome.attempts).toBe(2)
			expect(outcome.reason).toBe('max-repairs-exceeded')
		}
		expect(aborts).toHaveLength(1)
	})

	it('fires onAttempt for every generation', async () => {
		const { fn } = makeGenerate([
			{ name: 'Ana', age: -1 },
			{ name: 'Ana', age: 30 },
		])
		const seen: number[] = []
		await runWithVerification(fn, {
			validators: [zodValidator(schema)],
			onAttempt: (a) => seen.push(a.attempt),
		})
		expect(seen).toEqual([0, 1])
	})

	it('throws when validators list is empty', async () => {
		const fn: GenerateFn<string> = async () => 'x'
		await expect(runWithVerification(fn, { validators: [] })).rejects.toThrow(/at least one/)
	})

	it('aggregates failures from multiple validators on the same attempt', async () => {
		const validator: Validator<{ name: string }> = {
			name: 'len',
			validate: (v) =>
				v.name.length > 2
					? { valid: true, failures: [] }
					: ({
							valid: false,
							failures: [{ validator: 'len', reason: 'name must be > 2 chars' }],
						} satisfies ValidationOutcome),
		}
		const { fn, repairsSeen } = makeGenerate([{ name: 'X' }, { name: 'X' }])
		const outcome = await runWithVerification(fn, {
			validators: [zodValidator(z.object({ name: z.string() })), validator],
			maxRepairs: 1,
		})
		expect(outcome.status).toBe('aborted')
		expect(repairsSeen[1]?.failures.length).toBeGreaterThan(0)
	})

	it('uses a custom formatRepairPrompt when provided', async () => {
		const { fn, repairsSeen } = makeGenerate([
			{ name: '', age: -1 },
			{ name: 'Ok', age: 1 },
		])
		await runWithVerification(fn, {
			validators: [zodValidator(z.object({ name: z.string().min(1), age: z.number().positive() }))],
			formatRepairPrompt: (failures) => `Custom prompt — ${failures.length} failure(s)`,
		})
		expect(repairsSeen[1]?.repairPrompt).toBe('Custom prompt — 2 failure(s)')
	})

	it('passes attempt index and previousFailures to the validator context', async () => {
		const seenContexts: ValidationContext[] = []
		const validator: Validator<number> = {
			name: 'memo',
			validate: (_v, ctx) => {
				seenContexts.push(ctx)
				return ctx.attempt < 1
					? ({
							valid: false,
							failures: [{ validator: 'memo', reason: 'try again' }],
						} satisfies ValidationOutcome)
					: { valid: true, failures: [] }
			},
		}
		const { fn } = makeGenerate([1, 2])
		await runWithVerification(fn, { validators: [validator] })
		expect(seenContexts[0]).toEqual({ attempt: 0, previousFailures: [] })
		expect(seenContexts[1].attempt).toBe(1)
		expect(seenContexts[1].previousFailures[0].reason).toBe('try again')
	})
})
