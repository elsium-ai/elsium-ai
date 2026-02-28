import { generateId } from '@elsium-ai/core'
import type { Span, SpanData, SpanHandler, SpanKind } from './span'
import { createSpan } from './span'

export interface TracerConfig {
	output?: TracerOutput[]
	costTracking?: boolean
	samplingRate?: number
	maxSpans?: number
}

export type TracerOutput = 'console' | 'json-file' | TracerExporter

export interface TracerExporter {
	name: string
	export(spans: SpanData[]): void | Promise<void>
}

export interface CostReport {
	totalCost: number
	totalTokens: number
	totalInputTokens: number
	totalOutputTokens: number
	callCount: number
	byModel: Record<
		string,
		{
			cost: number
			tokens: number
			calls: number
		}
	>
}

export interface Tracer {
	startSpan(name: string, kind?: SpanKind): Span
	getSpans(): SpanData[]
	getCostReport(): CostReport
	trackLLMCall(data: {
		model: string
		inputTokens: number
		outputTokens: number
		cost: number
		latencyMs: number
	}): void
	reset(): void
	flush(): Promise<void>
}

export function observe(config: TracerConfig = {}): Tracer {
	const {
		output = ['console'],
		costTracking = true,
		samplingRate = 1.0,
		maxSpans = 10_000,
	} = config

	const spans: SpanData[] = []
	const llmCalls: Array<{
		model: string
		inputTokens: number
		outputTokens: number
		cost: number
		latencyMs: number
	}> = []

	const exporters: TracerExporter[] = []
	const handlers: SpanHandler[] = []

	for (const out of output) {
		if (out === 'console') {
			handlers.push(consoleHandler)
		} else if (out === 'json-file') {
			// json-file export happens on flush
		} else {
			exporters.push(out)
		}
	}

	function shouldSample(): boolean {
		if (samplingRate >= 1.0) return true
		return Math.random() < samplingRate
	}

	function onSpanEnd(span: SpanData) {
		if (spans.length >= maxSpans) {
			spans.shift()
		}
		spans.push(span)
		for (const handler of handlers) {
			handler(span)
		}
	}

	return {
		startSpan(name: string, kind?: SpanKind): Span {
			if (!shouldSample()) {
				return createNoopSpan(name, kind)
			}
			return createSpan(name, { kind, onEnd: onSpanEnd })
		},

		getSpans(): SpanData[] {
			return [...spans]
		},

		getCostReport(): CostReport {
			const byModel: CostReport['byModel'] = {}

			for (const call of llmCalls) {
				if (!byModel[call.model]) {
					byModel[call.model] = { cost: 0, tokens: 0, calls: 0 }
				}
				byModel[call.model].cost += call.cost
				byModel[call.model].tokens += call.inputTokens + call.outputTokens
				byModel[call.model].calls++
			}

			return {
				totalCost: llmCalls.reduce((sum, c) => sum + c.cost, 0),
				totalTokens: llmCalls.reduce((sum, c) => sum + c.inputTokens + c.outputTokens, 0),
				totalInputTokens: llmCalls.reduce((sum, c) => sum + c.inputTokens, 0),
				totalOutputTokens: llmCalls.reduce((sum, c) => sum + c.outputTokens, 0),
				callCount: llmCalls.length,
				byModel,
			}
		},

		trackLLMCall(data) {
			if (!costTracking) return
			llmCalls.push(data)
		},

		reset() {
			spans.length = 0
			llmCalls.length = 0
		},

		async flush() {
			for (const exporter of exporters) {
				await exporter.export([...spans])
			}
		},
	}
}

function consoleHandler(span: SpanData): void {
	const duration = span.durationMs !== undefined ? `${span.durationMs}ms` : 'running'
	const status = span.status === 'error' ? '[ERROR]' : span.status === 'ok' ? '[OK]' : '[...]'

	console.log(
		JSON.stringify({
			trace: span.traceId,
			span: span.name,
			kind: span.kind,
			status: status,
			duration,
			...(Object.keys(span.metadata).length > 0 ? { metadata: span.metadata } : {}),
		}),
	)
}

function createNoopSpan(name: string, kind?: SpanKind): Span {
	const id = generateId('spn')
	const traceId = generateId('trc')

	return {
		id,
		traceId,
		name,
		kind: kind ?? 'custom',
		addEvent() {},
		setMetadata() {},
		end() {},
		child(childName, childKind) {
			return createNoopSpan(childName, childKind)
		},
		toJSON() {
			return {
				id,
				traceId,
				name,
				kind: kind ?? 'custom',
				status: 'ok',
				startTime: 0,
				metadata: {},
				events: [],
			}
		},
	}
}
