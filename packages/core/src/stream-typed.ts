import type { z } from 'zod'
import type { StreamEvent } from './types'

export type ToolSchemaMap = Record<string, z.ZodType<unknown>>

export type ToolArgs<T extends ToolSchemaMap, K extends keyof T> = T[K] extends z.ZodType<infer A>
	? A
	: never

export type TypedToolCallComplete<T extends ToolSchemaMap> = {
	[K in keyof T & string]: {
		type: 'tool_call_complete'
		toolCallId: string
		toolCall: { id: string; name: K; arguments: ToolArgs<T, K> }
	}
}[keyof T & string]

export type UnknownToolCallComplete = {
	type: 'tool_call_complete'
	toolCallId: string
	toolCall: { id: string; name: string; arguments: unknown }
	parseError: { reason: string; raw: string }
}

export type TypedStreamEvent<T extends ToolSchemaMap> =
	| StreamEvent
	| TypedToolCallComplete<T>
	| UnknownToolCallComplete

interface PendingToolCall {
	id: string
	name: string
	argsBuffer: string
}

function tryParseArguments(
	schema: z.ZodType<unknown> | undefined,
	raw: string,
): { ok: true; value: unknown } | { ok: false; reason: string } {
	let parsedJson: unknown
	try {
		parsedJson = raw.length === 0 ? {} : JSON.parse(raw)
	} catch (e) {
		return { ok: false, reason: e instanceof Error ? e.message : 'JSON parse failed' }
	}
	if (!schema) return { ok: true, value: parsedJson }
	const result = schema.safeParse(parsedJson)
	if (result.success) return { ok: true, value: result.data }
	return { ok: false, reason: result.error.issues.map((i) => i.message).join('; ') }
}

function emitComplete<T extends ToolSchemaMap>(
	pending: PendingToolCall,
	schemas: T,
): TypedStreamEvent<T> {
	const schema = schemas[pending.name]
	const parsed = tryParseArguments(schema, pending.argsBuffer)
	if (parsed.ok) {
		return {
			type: 'tool_call_complete',
			toolCallId: pending.id,
			toolCall: {
				id: pending.id,
				name: pending.name,
				arguments: parsed.value,
			},
		} as TypedToolCallComplete<T>
	}
	return {
		type: 'tool_call_complete',
		toolCallId: pending.id,
		toolCall: { id: pending.id, name: pending.name, arguments: pending.argsBuffer },
		parseError: { reason: parsed.reason, raw: pending.argsBuffer },
	}
}

interface PendingState {
	pending: Map<string, PendingToolCall>
	lastStartedId?: string
}

function handleToolCallStart(
	event: StreamEvent & { type: 'tool_call_start' },
	state: PendingState,
): void {
	const id = event.toolCall.id || `auto_${state.pending.size}`
	state.pending.set(id, { id, name: event.toolCall.name, argsBuffer: '' })
	state.lastStartedId = id
}

function handleToolCallDelta(
	event: StreamEvent & { type: 'tool_call_delta' },
	state: PendingState,
): void {
	const id = event.toolCallId || state.lastStartedId
	if (!id) return
	const entry = state.pending.get(id)
	if (entry) entry.argsBuffer += event.arguments
}

function handleToolCallEnd<T extends ToolSchemaMap>(
	event: StreamEvent & { type: 'tool_call_end' },
	state: PendingState,
	schemas: T,
): TypedStreamEvent<T> | undefined {
	const id = event.toolCallId || state.lastStartedId
	if (!id) return undefined
	const entry = state.pending.get(id)
	if (!entry) return undefined
	state.pending.delete(id)
	return emitComplete(entry, schemas)
}

export async function* withToolTypes<T extends ToolSchemaMap>(
	source: AsyncIterable<StreamEvent>,
	schemas: T,
): AsyncIterable<TypedStreamEvent<T>> {
	const state: PendingState = { pending: new Map() }

	for await (const event of source) {
		yield event
		if (event.type === 'tool_call_start') handleToolCallStart(event, state)
		else if (event.type === 'tool_call_delta') handleToolCallDelta(event, state)
		else if (event.type === 'tool_call_end') {
			const complete = handleToolCallEnd(event, state, schemas)
			if (complete) yield complete
		}
	}

	for (const entry of state.pending.values()) {
		yield emitComplete(entry, schemas)
	}
}
