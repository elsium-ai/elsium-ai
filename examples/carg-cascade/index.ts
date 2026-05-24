/**
 * Example: CARG — Cost-Aware Routed Generation
 *
 * Three tiers, classifier-driven skipping, audit stream of escalations.
 *
 * Usage:
 *   export ANTHROPIC_API_KEY=your-key
 *   bun examples/carg-cascade/index.ts
 */

import { env } from '@elsium-ai/core'
import {
	type CascadeAuditEvent,
	type Tier,
	createCascadeRouter,
	createHeuristicClassifier,
} from '@elsium-ai/gateway'

const tiers: Tier[] = [
	{ name: 'haiku', provider: 'anthropic', model: 'claude-haiku-4-5-20251001', maxDifficulty: 0.4 },
	{ name: 'sonnet', provider: 'anthropic', model: 'claude-sonnet-4-6', maxDifficulty: 0.8 },
	{ name: 'opus', provider: 'anthropic', model: 'claude-opus-4-7' },
]

const events: CascadeAuditEvent[] = []
const router = createCascadeRouter(
	{
		tiers,
		classifier: createHeuristicClassifier(),
		escalateOnFailure: {
			onProviderError: true,
			validator: async (response) => {
				const text = typeof response.message.content === 'string' ? response.message.content : ''
				return text.trim().length > 0 ? { valid: true } : { valid: false, reason: 'empty response' }
			},
			maxEscalations: 2,
		},
		onAudit: (event) => events.push(event),
	},
	{ apiKeys: { anthropic: env('ANTHROPIC_API_KEY') } },
)

console.log('\n=== Easy request — expect haiku ===')
const easy = await router.complete({
	messages: [{ role: 'user', content: 'What is 2+2?' }],
})
console.log(`served by: ${easy.tier}`)
console.log(`classifier: ${JSON.stringify(easy.classification)}`)
console.log(`attempts: ${easy.attempts.map((a) => `${a.tier}=${a.status}`).join(' → ')}`)
console.log(`totalCost: $${easy.totalCost.toFixed(6)}`)

console.log('\n=== Hard request — expect classifier to skip haiku + sonnet ===')
const hard = await router.complete({
	messages: [
		{
			role: 'user',
			content:
				'Analyze and prove why this algorithm is optimal in O(n log n): given a stream of N numbers, design a data structure that maintains the median in O(log n) per update.',
		},
	],
})
console.log(`served by: ${hard.tier}`)
console.log(`classifier: ${JSON.stringify(hard.classification)}`)
console.log(`attempts: ${hard.attempts.map((a) => `${a.tier}=${a.status}`).join(' → ')}`)

console.log('\n=== Audit stream ===')
for (const e of events) {
	console.log(
		`  ${e.type}: ${e.tier}${e.reason ? ` (${e.reason})` : ''}${e.detail ? ` — ${e.detail}` : ''}`,
	)
}
