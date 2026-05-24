/**
 * Example: thinking / reasoning stream events
 *
 * Usage:
 *   export ANTHROPIC_API_KEY=your-key
 *   bun examples/thinking-stream/index.ts
 */

import { env } from '@elsium-ai/core'
import { gateway } from '@elsium-ai/gateway'

const llm = gateway({ provider: 'anthropic', apiKey: env('ANTHROPIC_API_KEY') })

const stream = llm.stream({
	messages: [
		{
			role: 'user',
			content: 'Plan a 3-day itinerary in Lisbon for a software engineer who loves seafood.',
		},
	],
	model: 'claude-sonnet-4-6',
	thinking: { enabled: true, budgetTokens: 4000 },
	maxTokens: 1500,
})

let thinkingChars = 0
let textChars = 0

for await (const event of stream) {
	if (event.type === 'thinking_start') {
		process.stderr.write('\n💭 [thinking start]\n')
	} else if (event.type === 'thinking_delta') {
		process.stderr.write(event.text)
		thinkingChars += event.text.length
	} else if (event.type === 'thinking_end') {
		process.stderr.write('\n💭 [thinking end]\n\n')
	} else if (event.type === 'text_delta') {
		process.stdout.write(event.text)
		textChars += event.text.length
	} else if (event.type === 'message_end') {
		console.log('\n\n=== usage ===')
		console.log(`  inputTokens:     ${event.usage.inputTokens}`)
		console.log(`  outputTokens:    ${event.usage.outputTokens}`)
		console.log(`  reasoningTokens: ${event.usage.reasoningTokens ?? '(not reported by provider)'}`)
		console.log(`  thinking chars:  ${thinkingChars}`)
		console.log(`  text chars:      ${textChars}`)
	}
}
