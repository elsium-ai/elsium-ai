/**
 * Example: replayFrom — time-travel replay with overrides
 *
 * Usage:
 *   bun examples/replay-from/index.ts
 */

import { createTraceRecorder, replayFrom } from '@elsium-ai/testing'

// ─── 1. Record a pipeline run ───────────────────────────────────

const recorder = createTraceRecorder({ agentId: 'news-bot' })

const researchInput = { query: 'elsium-ai release notes 0.12' }
const researchOutput = { sources: ['blog.elsium.ai/0.12', 'github.com/elsium-ai/elsium-ai'] }
recorder.recordStep({
	key: 'research',
	input: researchInput,
	output: researchOutput,
	durationMs: 850,
})

const summarizeOutput = {
	bullets: ['Capability tokens', 'Verifiable execution', 'CARG cost-aware routing'],
}
recorder.recordStep({
	key: 'summarize',
	input: researchOutput,
	output: summarizeOutput,
	durationMs: 420,
})

const tweetOutput = { tweet: 'Elsium 0.12: capability tokens + verifiable exec + CARG 🚀' }
recorder.recordStep({
	key: 'tweet',
	input: summarizeOutput,
	output: tweetOutput,
	durationMs: 310,
})

const trace = recorder.finish()
console.log('\n[recorded trace]')
console.log('  steps:', trace.steps.map((s) => s.key).join(' → '))

// ─── 2. Replay from the start with a transformed query ──────────

console.log('\n[2] replay from step 0 — transform initial query')
const result1 = await replayFrom(trace, {
	fromStep: 0,
	executor: async ({ key, input }) => {
		if (key === 'research') {
			return { sources: [`fresh-search-for:${(input as { query: string }).query}`] }
		}
		if (key === 'summarize') return { bullets: ['(live) re-summarized'] }
		return { tweet: '(live) new tweet from transformed query' }
	},
	overrides: {
		research: {
			kind: 'transform',
			input: (i) => ({ ...(i as { query: string }), query: 'elsium-ai roadmap 2026' }),
		},
	},
})
for (const step of result1.steps) {
	console.log(`  ${step.key.padEnd(10)} [${step.source}${step.overridden ? ' +override' : ''}]`)
}

// ─── 3. Replay mid-run — only summarize+tweet execute live ──────

console.log('\n[3] replay from "summarize" — research is replayed from cache')
const result2 = await replayFrom(trace, {
	fromStep: 'summarize',
	executor: async ({ key, input }) => {
		if (key === 'summarize') {
			const sources = (input as { sources: string[] }).sources
			return { bullets: sources.map((s) => `bullet-from:${s}`) }
		}
		return { tweet: '(live tweet from replayed research)' }
	},
})
for (const step of result2.steps) {
	console.log(`  ${step.key.padEnd(10)} [${step.source}]`)
}
console.log('  final:', result2.finalOutput)

// ─── 4. Replace — hard-pin a step output ────────────────────────

console.log('\n[4] replay from 0 — pin summarize output via { kind: "replace" }')
const result3 = await replayFrom(trace, {
	fromStep: 0,
	executor: async ({ key, originalStep }) => originalStep?.output as object,
	overrides: {
		summarize: { kind: 'replace', output: { bullets: ['PINNED: bullet A', 'PINNED: bullet B'] } },
	},
})
for (const step of result3.steps) {
	console.log(
		`  ${step.key.padEnd(10)} [${step.source}${step.overridden ? ' +override' : ''}] →`,
		step.output,
	)
}
