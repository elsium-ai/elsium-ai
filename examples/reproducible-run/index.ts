/**
 * Example: reproducible runs — seed propagation + determinism report
 *
 * Usage:
 *   bun examples/reproducible-run/index.ts
 *
 * No API key needed. Uses a deterministic-by-seed mock provider so you can see
 * that the seed configured on the agent reaches every LLM request, and that the
 * built-in determinism tooling confirms reproducibility.
 *
 * With a real provider, reproducibility depends on the provider honoring `seed`
 * + `temperature: 0`. Elsium gives you the tools to constrain and *measure* it;
 * it cannot make a hosted model deterministic on its own. Pair this with a
 * signed ExecutionProof + `elsium verify` (see examples/verifiable-agent-execution).
 */

import type { AgentDependencies } from '@elsium-ai/agents'
import { defineAgent } from '@elsium-ai/agents'
import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'
import { extractText } from '@elsium-ai/core'
import { assertDeterministic, createPinStore, pinOutput } from '@elsium-ai/testing'

/** Mock provider whose output is a pure function of (last user message, seed). */
function deterministicDeps(): AgentDependencies {
	return {
		async complete(request: CompletionRequest): Promise<LLMResponse> {
			const userText = extractText(request.messages[request.messages.length - 1]?.content ?? '')
			const seedTag = request.seed === undefined ? 'no-seed' : `seed-${request.seed}`
			return {
				id: 'msg_1',
				message: { role: 'assistant', content: `answer[${seedTag}] to: ${userText}` },
				usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
				cost: { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' },
				model: 'mock',
				provider: 'mock',
				stopReason: 'end_turn',
				latencyMs: 0,
				traceId: 'trc',
			}
		},
	}
}

const question = 'What is the capital of France?'

// ─── [1] Seed propagation ───────────────────────────────────────

console.log('\n[1] the agent seed reaches every LLM request')
const agent = defineAgent(
	{ name: 'repro', system: 'Answer concisely.', seed: 42 },
	deterministicDeps(),
)
const r1 = await agent.run(question)
console.log('  →', extractText(r1.message.content)) // contains seed-42

// ─── [2] Determinism report (built-in, no external tool) ────────

console.log('\n[2] assertDeterministic: same seed → identical output across N runs')
const det = await assertDeterministic(
	(seed) => agent.run(question, { seed }).then((r) => extractText(r.message.content)),
	{ runs: 5, seed: 42 },
)
console.log('  → deterministic:', det.deterministic, '| unique outputs:', det.uniqueOutputs)

// ─── [3] Different seed → different output (seed truly flows) ────

console.log('\n[3] a different seed produces a different output')
const a = extractText((await agent.run(question, { seed: 1 })).message.content)
const b = extractText((await agent.run(question, { seed: 2 })).message.content)
console.log('  → seed 1:', a)
console.log('  → seed 2:', b)
console.log('  → differ:', a !== b)

// ─── [4] Output pinning — regression detection ──────────────────

console.log('\n[4] pinOutput: detect when a pinned output changes')
const store = createPinStore()
const first = await pinOutput(
	'capital-of-france',
	store,
	() => agent.run(question, { seed: 42 }).then((r) => extractText(r.message.content)),
	{ prompt: question, model: 'mock', seed: 42 },
)
console.log('  → first run:', first.status) // 'new'
const second = await pinOutput(
	'capital-of-france',
	store,
	() => agent.run(question, { seed: 42 }).then((r) => extractText(r.message.content)),
	{ prompt: question, model: 'mock', seed: 42 },
)
console.log('  → second run:', second.status) // 'match'
