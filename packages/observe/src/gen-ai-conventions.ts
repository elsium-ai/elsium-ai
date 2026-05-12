import type { SpanData, SpanKind } from './span'

// ─── Spec & opt-in flag types ───────────────────────────────────

export type GenAISpecVersion = 'v1.36' | 'v1.37' | (string & {})

export type SemconvStabilityFlag = 'gen_ai_latest_experimental' | (string & {})

export type GenAIOperationName =
	| 'chat'
	| 'text_completion'
	| 'embeddings'
	| 'agent.invoke'
	| 'tool.execute'
	| (string & {})

// ─── Attribute shapes (per OTel GenAI semconv, in Development) ──

export interface GenAIRequestAttributes {
	readonly 'gen_ai.system': string
	readonly 'gen_ai.operation.name': GenAIOperationName
	readonly 'gen_ai.request.model': string
	readonly 'gen_ai.request.max_tokens'?: number
	readonly 'gen_ai.request.temperature'?: number
	readonly 'gen_ai.request.top_p'?: number
	readonly 'gen_ai.request.top_k'?: number
}

export interface GenAIResponseAttributes {
	readonly 'gen_ai.response.model'?: string
	readonly 'gen_ai.response.id'?: string
	readonly 'gen_ai.response.finish_reasons'?: readonly string[]
	readonly 'gen_ai.usage.input_tokens'?: number
	readonly 'gen_ai.usage.output_tokens'?: number
}

export interface GenAIToolAttributes {
	readonly 'gen_ai.tool.name': string
	readonly 'gen_ai.tool.call.id'?: string
	readonly 'gen_ai.tool.type'?: 'function' | 'retrieval' | 'code_interpreter'
	readonly 'gen_ai.operation.name'?: GenAIOperationName
}

export type GenAIAttributes =
	| GenAIRequestAttributes
	| (GenAIRequestAttributes & GenAIResponseAttributes)
	| GenAIToolAttributes

// ─── Mapper + Registry ──────────────────────────────────────────

export interface GenAIMapper<K extends SpanKind = SpanKind> {
	readonly kind: K
	readonly specVersion: GenAISpecVersion
	map(span: SpanData): GenAIAttributes | null
}

export interface GenAIConventionRegistry {
	register<K extends SpanKind>(mapper: GenAIMapper<K>): void
	getMapper(kind: SpanKind, version?: GenAISpecVersion): GenAIMapper | null
	listVersions(): readonly GenAISpecVersion[]
	defaultVersion: GenAISpecVersion
}

// ─── Emission policy ────────────────────────────────────────────

export interface SemconvStabilityConfig {
	readonly optIn: ReadonlySet<SemconvStabilityFlag>
	readonly source: 'env' | 'explicit'
}

export interface EmissionPolicy {
	shouldEmitLegacy(): boolean
	shouldEmitGenAI(): boolean
	resolvedFromEnv(): SemconvStabilityConfig
}

export interface EmissionPolicyConfig {
	optIn?: readonly SemconvStabilityFlag[] | ReadonlySet<SemconvStabilityFlag>
	env?: { readonly OTEL_SEMCONV_STABILITY_OPT_IN?: string }
}

const GEN_AI_FLAG: SemconvStabilityFlag = 'gen_ai_latest_experimental'
const DEFAULT_SPEC_VERSION: GenAISpecVersion = 'v1.36'

export function parseSemconvOptIn(envValue: string | undefined): ReadonlySet<SemconvStabilityFlag> {
	if (!envValue) return new Set<SemconvStabilityFlag>()
	const flags = envValue
		.split(',')
		.map((s) => s.trim())
		.filter((s) => s.length > 0)
	return new Set<SemconvStabilityFlag>(flags)
}

export function createEmissionPolicy(config: EmissionPolicyConfig = {}): EmissionPolicy {
	let optIn: ReadonlySet<SemconvStabilityFlag>
	let source: 'env' | 'explicit'

	if (config.optIn !== undefined) {
		optIn = config.optIn instanceof Set ? config.optIn : new Set(config.optIn)
		source = 'explicit'
	} else {
		const env = config.env ?? (typeof process !== 'undefined' ? process.env : undefined)
		optIn = parseSemconvOptIn(env?.OTEL_SEMCONV_STABILITY_OPT_IN)
		source = 'env'
	}

	const emitGenAI = optIn.has(GEN_AI_FLAG)

	return {
		shouldEmitLegacy(): boolean {
			return !emitGenAI
		},
		shouldEmitGenAI(): boolean {
			return emitGenAI
		},
		resolvedFromEnv(): SemconvStabilityConfig {
			return { optIn, source }
		},
	}
}

// ─── Metadata extractors (tolerant — return undefined on miss) ──

function readString(meta: Record<string, unknown>, key: string): string | undefined {
	const v = meta[key]
	return typeof v === 'string' && v.length > 0 ? v : undefined
}

function readNumber(meta: Record<string, unknown>, key: string): number | undefined {
	const v = meta[key]
	return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function readStringArray(
	meta: Record<string, unknown>,
	key: string,
): readonly string[] | undefined {
	const v = meta[key]
	if (Array.isArray(v) && v.every((x): x is string => typeof x === 'string')) {
		return v
	}
	if (typeof v === 'string' && v.length > 0) return [v]
	return undefined
}

// ─── Built-in mappers for spec v1.36 ────────────────────────────

function buildLlmRequestAttrs(
	meta: Record<string, unknown>,
	provider: string,
	model: string,
): GenAIRequestAttributes {
	const operationName: GenAIOperationName = readString(meta, 'operationName') ?? 'chat'
	const maxTokens = readNumber(meta, 'maxTokens')
	const temperature = readNumber(meta, 'temperature')
	const topP = readNumber(meta, 'topP')
	const topK = readNumber(meta, 'topK')
	return {
		'gen_ai.system': provider,
		'gen_ai.operation.name': operationName,
		'gen_ai.request.model': model,
		...(maxTokens !== undefined && { 'gen_ai.request.max_tokens': maxTokens }),
		...(temperature !== undefined && { 'gen_ai.request.temperature': temperature }),
		...(topP !== undefined && { 'gen_ai.request.top_p': topP }),
		...(topK !== undefined && { 'gen_ai.request.top_k': topK }),
	}
}

function buildLlmResponseAttrs(meta: Record<string, unknown>): GenAIResponseAttributes | null {
	const responseModel = readString(meta, 'responseModel')
	const responseId = readString(meta, 'responseId')
	const finishReasons =
		readStringArray(meta, 'finishReasons') ?? readStringArray(meta, 'finishReason')
	const inputTokens = readNumber(meta, 'inputTokens')
	const outputTokens = readNumber(meta, 'outputTokens')

	if (
		responseModel === undefined &&
		responseId === undefined &&
		finishReasons === undefined &&
		inputTokens === undefined &&
		outputTokens === undefined
	) {
		return null
	}

	return {
		...(responseModel !== undefined && { 'gen_ai.response.model': responseModel }),
		...(responseId !== undefined && { 'gen_ai.response.id': responseId }),
		...(finishReasons !== undefined && { 'gen_ai.response.finish_reasons': finishReasons }),
		...(inputTokens !== undefined && { 'gen_ai.usage.input_tokens': inputTokens }),
		...(outputTokens !== undefined && { 'gen_ai.usage.output_tokens': outputTokens }),
	}
}

const llmMapperV136: GenAIMapper<'llm'> = {
	kind: 'llm',
	specVersion: 'v1.36',
	map(span) {
		const meta = span.metadata
		const provider = readString(meta, 'provider')
		const model = readString(meta, 'model') ?? readString(meta, 'requestModel')
		if (!provider || !model) return null

		const request = buildLlmRequestAttrs(meta, provider, model)
		const response = buildLlmResponseAttrs(meta)
		return response === null ? request : { ...request, ...response }
	},
}

const toolMapperV136: GenAIMapper<'tool'> = {
	kind: 'tool',
	specVersion: 'v1.36',
	map(span) {
		const meta = span.metadata
		const toolName = readString(meta, 'toolName') ?? readString(meta, 'name') ?? span.name
		if (!toolName) return null

		const rawType = readString(meta, 'toolType')
		const validType: 'function' | 'retrieval' | 'code_interpreter' | undefined =
			rawType === 'function' || rawType === 'retrieval' || rawType === 'code_interpreter'
				? rawType
				: undefined

		const toolCallId = readString(meta, 'toolCallId')

		return {
			'gen_ai.tool.name': toolName,
			...(toolCallId !== undefined && { 'gen_ai.tool.call.id': toolCallId }),
			...(validType !== undefined && { 'gen_ai.tool.type': validType }),
			'gen_ai.operation.name': 'tool.execute',
		}
	},
}

const agentMapperV136: GenAIMapper<'agent'> = {
	kind: 'agent',
	specVersion: 'v1.36',
	map(span) {
		const meta = span.metadata
		const provider = readString(meta, 'provider') ?? 'elsium'
		const model = readString(meta, 'model') ?? readString(meta, 'agentName') ?? span.name
		if (!model) return null

		const request: GenAIRequestAttributes = {
			'gen_ai.system': provider,
			'gen_ai.operation.name': 'agent.invoke',
			'gen_ai.request.model': model,
		}

		const inputTokens = readNumber(meta, 'inputTokens')
		const outputTokens = readNumber(meta, 'outputTokens')

		if (inputTokens === undefined && outputTokens === undefined) return request

		const response: GenAIResponseAttributes = {
			...(inputTokens !== undefined && { 'gen_ai.usage.input_tokens': inputTokens }),
			...(outputTokens !== undefined && { 'gen_ai.usage.output_tokens': outputTokens }),
		}

		return { ...request, ...response }
	},
}

// ─── Registry impl ──────────────────────────────────────────────

export function createGenAIConventionRegistry(
	defaultVersion: GenAISpecVersion = DEFAULT_SPEC_VERSION,
): GenAIConventionRegistry {
	const mappers = new Map<string, GenAIMapper>()
	let currentDefault: GenAISpecVersion = defaultVersion

	function keyOf(kind: SpanKind, version: GenAISpecVersion): string {
		return `${kind}::${version}`
	}

	return {
		register<K extends SpanKind>(mapper: GenAIMapper<K>): void {
			mappers.set(keyOf(mapper.kind, mapper.specVersion), mapper)
		},

		getMapper(kind: SpanKind, version?: GenAISpecVersion): GenAIMapper | null {
			return mappers.get(keyOf(kind, version ?? currentDefault)) ?? null
		},

		listVersions(): readonly GenAISpecVersion[] {
			const versions = new Set<GenAISpecVersion>()
			for (const key of mappers.keys()) {
				const idx = key.indexOf('::')
				if (idx >= 0) versions.add(key.slice(idx + 2) as GenAISpecVersion)
			}
			return Array.from(versions)
		},

		get defaultVersion(): GenAISpecVersion {
			return currentDefault
		},

		set defaultVersion(v: GenAISpecVersion) {
			currentDefault = v
		},
	}
}

let defaultRegistry: GenAIConventionRegistry | null = null

export function getDefaultRegistry(): GenAIConventionRegistry {
	if (defaultRegistry) return defaultRegistry
	const reg = createGenAIConventionRegistry()
	reg.register(llmMapperV136)
	reg.register(toolMapperV136)
	reg.register(agentMapperV136)
	defaultRegistry = reg
	return reg
}

export function resetDefaultRegistry(): void {
	defaultRegistry = null
}
