/**
 * Example: Confidence-Augmented Generation (CAG)
 *
 * Three strategies + a threshold gate. Demonstrates self-consistency on a
 * deterministic-ish answer ("What is the capital of France?") and a custom
 * escalation that "upgrades" to a stronger model when confidence is low.
 *
 * Usage:
 *   export ANTHROPIC_API_KEY=your-key
 *   bun examples/confidence-strategies/index.ts
 */

import {
	ConfidenceTooLowError,
	judgeEnsemble,
	logprobScore,
	requireConfidence,
	selfConsistency,
} from '@elsium-ai/agents'
import { env } from '@elsium-ai/core'
import { gateway } from '@elsium-ai/gateway'

const llm = gateway({ provider: 'anthropic', apiKey: env('ANTHROPIC_API_KEY') })

async function ask(prompt: string, model = 'claude-haiku-4-5-20251001'): Promise<string> {
	const response = await llm.complete({
		messages: [{ role: 'user', content: prompt }],
		model,
		maxTokens: 32,
		temperature: 1,
	})
	const text = typeof response.message.content === 'string' ? response.message.content : ''
	return text.trim().split(/[.\n]/)[0]
}

// ─── 1. self-consistency ────────────────────────────────────────

console.log('\n[1] selfConsistency over 5 samples')
const sc = selfConsistency<string>({ samples: 5 })
const scResult = await sc.score(async () => ({
	value: await ask('What is the capital of France? Reply with one word.'),
}))
console.log('  winner:', JSON.stringify(scResult.value))
console.log('  confidence:', scResult.confidence.toFixed(2))

// ─── 2. judge ensemble (cheap heuristic judges) ─────────────────

const lengthJudge = {
	name: 'length-judge',
	async score(value: string) {
		const ok = value.length > 0 && value.length < 50
		return { score: ok ? 0.9 : 0.3 }
	},
}
const capitalJudge = {
	name: 'starts-uppercase',
	async score(value: string) {
		return { score: /^[A-Z]/.test(value) ? 0.95 : 0.5 }
	},
}

console.log('\n[2] judgeEnsemble (mean) — same answer, two cheap judges')
const je = judgeEnsemble<string>({
	judges: [lengthJudge, capitalJudge],
	aggregator: 'mean',
})
const jeResult = await je.score(async () => ({ value: scResult.value }))
console.log('  confidence:', jeResult.confidence.toFixed(2))
console.log('  judgments:', jeResult.details)

// ─── 3. logprob (graceful fallback when provider lacks logprobs) ─

console.log('\n[3] logprobScore — falls back to 0.5 when provider omits logprobs')
const lp = logprobScore<string>()
const lpResult = await lp.score(async () => {
	const response = await llm.complete({
		messages: [{ role: 'user', content: 'Capital of Italy in one word.' }],
		maxTokens: 16,
	})
	return {
		value: typeof response.message.content === 'string' ? response.message.content.trim() : '',
		raw: response,
	}
})
console.log('  value:', JSON.stringify(lpResult.value))
console.log('  confidence:', lpResult.confidence.toFixed(2), '(fallback expected for Anthropic)')

// ─── 4. requireConfidence with custom escalation ────────────────

console.log('\n[4] requireConfidence — escalate to a stronger model below 0.8')
try {
	const gated = await requireConfidence(
		async () => ({ value: await ask('Capital of Mongolia?') }),
		{
			strategy: selfConsistency<string>({ samples: 3 }),
			min: 0.8,
			below: async () => {
				console.log('  ↑ escalating to Sonnet…')
				return {
					value: await ask('Capital of Mongolia?', 'claude-sonnet-4-6'),
					confidence: 0.95,
					strategy: 'manual-escalation',
					samples: [{ value: 'escalated' }],
				}
			},
			onLowConfidence: (s) =>
				console.log(`  ⚠️  initial confidence ${s.confidence.toFixed(2)} below 0.8`),
		},
	)
	console.log('  result:', {
		status: gated.status,
		value: gated.value,
		confidence: gated.confidence,
	})
} catch (err) {
	if (err instanceof ConfidenceTooLowError) {
		console.log('  aborted:', err.message)
	} else {
		throw err
	}
}
