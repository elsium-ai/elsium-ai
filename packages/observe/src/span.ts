import { generateId } from '@elsium-ai/core'

export type SpanKind = 'llm' | 'tool' | 'agent' | 'workflow' | 'custom'
export type SpanStatus = 'running' | 'ok' | 'error'

export interface SpanData {
	id: string
	traceId: string
	parentId?: string
	name: string
	kind: SpanKind
	status: SpanStatus
	startTime: number
	endTime?: number
	durationMs?: number
	metadata: Record<string, unknown>
	events: SpanEvent[]
}

export interface SpanEvent {
	name: string
	timestamp: number
	data?: Record<string, unknown>
}

export interface Span {
	readonly id: string
	readonly traceId: string
	readonly name: string
	readonly kind: SpanKind

	addEvent(name: string, data?: Record<string, unknown>): void
	setMetadata(key: string, value: unknown): void
	end(result?: { status?: SpanStatus; metadata?: Record<string, unknown> }): void
	child(name: string, kind?: SpanKind): Span
	toJSON(): SpanData
}

export type SpanHandler = (span: SpanData) => void

export function createSpan(
	name: string,
	options: {
		traceId?: string
		parentId?: string
		kind?: SpanKind
		onEnd?: SpanHandler
	} = {},
): Span {
	const id = generateId('spn')
	const traceId = options.traceId ?? generateId('trc')
	const kind = options.kind ?? 'custom'
	const startTime = Date.now()

	const metadata: Record<string, unknown> = {}
	const events: SpanEvent[] = []
	let status: SpanStatus = 'running'
	let endTime: number | undefined

	const span: Span = {
		id,
		traceId,
		name,
		kind,

		addEvent(eventName: string, data?: Record<string, unknown>) {
			events.push({
				name: eventName,
				timestamp: Date.now(),
				data,
			})
		},

		setMetadata(key: string, value: unknown) {
			if (key === '__proto__' || key === 'constructor' || key === 'prototype') return
			metadata[key] = value
		},

		end(result) {
			if (endTime !== undefined) return

			endTime = Date.now()
			status = result?.status ?? 'ok'

			if (result?.metadata) {
				for (const [key, value] of Object.entries(result.metadata)) {
					if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
					metadata[key] = value
				}
			}

			options.onEnd?.(span.toJSON())
		},

		child(childName: string, childKind?: SpanKind): Span {
			return createSpan(childName, {
				traceId,
				parentId: id,
				kind: childKind ?? kind,
				onEnd: options.onEnd,
			})
		},

		toJSON(): SpanData {
			const duration = endTime !== undefined ? endTime - startTime : undefined
			return {
				id,
				traceId,
				parentId: options.parentId,
				name,
				kind,
				status,
				startTime,
				endTime,
				durationMs: duration !== undefined ? Math.round(duration) : undefined,
				metadata,
				events,
			}
		},
	}

	return span
}
