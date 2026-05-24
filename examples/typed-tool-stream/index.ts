/**
 * Example: withToolTypes — typed per-tool arguments on the stream
 *
 * Synthetic stream (no API key) so the discriminated narrowing is the focus.
 *
 * Usage:
 *   bun examples/typed-tool-stream/index.ts
 */

import { type StreamEvent, withToolTypes } from '@elsium-ai/core'
import { z } from 'zod'

const schemas = {
	get_weather: z.object({
		city: z.string(),
		unit: z.enum(['C', 'F']).optional(),
	}),
	search: z.object({
		query: z.string(),
		limit: z.number().int().positive(),
	}),
}

async function* mockStream(): AsyncIterable<StreamEvent> {
	yield { type: 'message_start', id: 'm1', model: 'mock' }
	yield { type: 'tool_call_start', toolCall: { id: 'tA', name: 'get_weather' } }
	yield { type: 'tool_call_delta', toolCallId: 'tA', arguments: '{"city":"Lisbon",' }
	yield { type: 'tool_call_delta', toolCallId: 'tA', arguments: '"unit":"C"}' }
	yield { type: 'tool_call_end', toolCallId: 'tA' }

	yield { type: 'tool_call_start', toolCall: { id: 'tB', name: 'search' } }
	yield { type: 'tool_call_delta', toolCallId: 'tB', arguments: '{"query":"elsium","limit":5}' }
	yield { type: 'tool_call_end', toolCallId: 'tB' }

	// Invalid args — schema mismatch (limit must be positive)
	yield { type: 'tool_call_start', toolCall: { id: 'tC', name: 'search' } }
	yield { type: 'tool_call_delta', toolCallId: 'tC', arguments: '{"query":"x","limit":-1}' }
	yield { type: 'tool_call_end', toolCallId: 'tC' }

	yield {
		type: 'message_end',
		usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
		stopReason: 'tool_use',
	}
}

for await (const event of withToolTypes(mockStream(), schemas)) {
	if (event.type === 'tool_call_complete') {
		if ('parseError' in event) {
			console.log(`❌ ${event.toolCall.name} — parse error: ${event.parseError.reason}`)
			console.log(`   raw: ${event.parseError.raw}`)
			continue
		}
		if (event.toolCall.name === 'get_weather') {
			console.log(
				`🌤️  ${event.toolCall.name}: city=${event.toolCall.arguments.city}, unit=${event.toolCall.arguments.unit ?? 'C'}`,
			)
		} else if (event.toolCall.name === 'search') {
			console.log(
				`🔎  ${event.toolCall.name}: query="${event.toolCall.arguments.query}", limit=${event.toolCall.arguments.limit}`,
			)
		}
	}
}
