/**
 * OTel GenAI Semantic Conventions — dual-emit demo.
 *
 * Builds 4 representative spans (llm, tool, agent, workflow), converts them
 * with both emission policies, and prints attributes side-by-side so you can
 * see exactly what changes when OTEL_SEMCONV_STABILITY_OPT_IN flips.
 */

import { type OTelSpan, createEmissionPolicy, toOTelSpan } from 'elsium-ai'
import type { SpanData } from 'elsium-ai'

function span(overrides: Partial<SpanData> & Pick<SpanData, 'name' | 'kind'>): SpanData {
	const now = Date.now()
	return {
		id: `spn_${Math.random().toString(36).slice(2, 10)}`,
		traceId: `trc_${Math.random().toString(36).slice(2, 14)}`,
		status: 'ok',
		startTime: now - 250,
		endTime: now,
		durationMs: 250,
		metadata: {},
		events: [],
		...overrides,
	}
}

const llmSpan = span({
	name: 'chat-completion',
	kind: 'llm',
	metadata: {
		provider: 'anthropic',
		model: 'claude-sonnet-4-6',
		operationName: 'chat',
		inputTokens: 142,
		outputTokens: 87,
		temperature: 0.7,
		finishReasons: ['stop'],
	},
})

const toolSpan = span({
	name: 'weather',
	kind: 'tool',
	metadata: {
		toolName: 'weather',
		toolCallId: 'call_abc123',
		toolType: 'function',
	},
})

const agentSpan = span({
	name: 'support-agent',
	kind: 'agent',
	metadata: {
		provider: 'elsium',
		agentName: 'support-agent',
		inputTokens: 320,
		outputTokens: 180,
	},
})

const workflowSpan = span({
	name: 'enrichment-pipeline',
	kind: 'workflow',
	metadata: {
		stage: 'enrichment',
		stepsCompleted: 3,
	},
})

function printSpan(label: string, otel: OTelSpan): void {
	console.log(`[${label}] ${otel.name}`)
	for (const attr of otel.attributes) {
		const v = attr.value
		let rendered: string
		if (v.stringValue !== undefined) rendered = `"${v.stringValue}"`
		else if (v.intValue !== undefined) rendered = String(v.intValue)
		else if (v.doubleValue !== undefined) rendered = String(v.doubleValue)
		else if (v.boolValue !== undefined) rendered = String(v.boolValue)
		else if (v.arrayValue !== undefined) {
			const items = v.arrayValue.values.map((x) => x.stringValue ?? String(x))
			rendered = `[${items.join(', ')}]`
		} else rendered = JSON.stringify(v)
		console.log(`  ${attr.key.padEnd(28)} = ${rendered}`)
	}
	console.log('')
}

console.log('═══════════════════════════════════════════════════════')
console.log('  Mode 1: Legacy (default — no OTEL_SEMCONV_STABILITY_OPT_IN)')
console.log('═══════════════════════════════════════════════════════\n')

const legacyPolicy = createEmissionPolicy({ env: {} })
printSpan('llm', toOTelSpan(llmSpan, { emissionPolicy: legacyPolicy }))
printSpan('tool', toOTelSpan(toolSpan, { emissionPolicy: legacyPolicy }))
printSpan('agent', toOTelSpan(agentSpan, { emissionPolicy: legacyPolicy }))
printSpan('workflow', toOTelSpan(workflowSpan, { emissionPolicy: legacyPolicy }))

console.log('═══════════════════════════════════════════════════════')
console.log('  Mode 2: GenAI experimental (opt-in)')
console.log('═══════════════════════════════════════════════════════\n')

const genaiPolicy = createEmissionPolicy({ optIn: ['gen_ai_latest_experimental'] })
printSpan('llm', toOTelSpan(llmSpan, { emissionPolicy: genaiPolicy }))
printSpan('tool', toOTelSpan(toolSpan, { emissionPolicy: genaiPolicy }))
printSpan('agent', toOTelSpan(agentSpan, { emissionPolicy: genaiPolicy }))
console.log('Note: workflow span has no GenAI mapper → falls back to legacy.')
printSpan('workflow', toOTelSpan(workflowSpan, { emissionPolicy: genaiPolicy }))

console.log('Tip: also try running with')
console.log(
	'  OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental bun examples/otel-genai-export/index.ts',
)
console.log('to see the env-driven path. Above we passed the policy explicitly.')

// To export to a real OTel collector instead of logging, replace the printing
// loop with:
//
//   import { createOTLPExporter } from 'elsium-ai'
//   const exporter = createOTLPExporter({
//     endpoint: 'http://localhost:4318/v1/traces',
//     semconv: { optIn: ['gen_ai_latest_experimental'] },
//   })
//   await exporter.export([llmSpan, toolSpan, agentSpan, workflowSpan])
//   await exporter.shutdown?.()
