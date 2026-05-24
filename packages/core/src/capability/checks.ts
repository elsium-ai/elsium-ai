import type {
	AgentCapability,
	CapabilityCheckResult,
	CapabilityToken,
	DataClass,
	LLMCapability,
	McpCapability,
	RagCapability,
	ToolCapability,
} from './types'

function allow(matched: AgentCapability): CapabilityCheckResult {
	return { allowed: true, matchedCapability: matched }
}

function deny(
	reason: CapabilityCheckResult['reason'],
	detail?: string,
	matched?: AgentCapability,
): CapabilityCheckResult {
	return { allowed: false, reason, detail, matchedCapability: matched }
}

function findToolCapability(token: CapabilityToken, toolName: string): ToolCapability | undefined {
	return token.capabilities.find(
		(c): c is ToolCapability => c.kind === 'tool' && c.name === toolName,
	)
}

function findLLMCapabilities(token: CapabilityToken): LLMCapability[] {
	return token.capabilities.filter((c): c is LLMCapability => c.kind === 'llm')
}

function findRagCapabilities(token: CapabilityToken): RagCapability[] {
	return token.capabilities.filter((c): c is RagCapability => c.kind === 'rag')
}

function findMcpCapabilities(token: CapabilityToken): McpCapability[] {
	return token.capabilities.filter((c): c is McpCapability => c.kind === 'mcp')
}

function checkFieldConstraints(cap: ToolCapability, input: unknown): CapabilityCheckResult | null {
	const constraints = cap.constraints
	if (!constraints || !input || typeof input !== 'object') return null
	const inputKeys = Object.keys(input as Record<string, unknown>)

	if (constraints.deniedFields?.length) {
		const violated = inputKeys.find((k) => constraints.deniedFields?.includes(k))
		if (violated) {
			return deny('denied-field', `field "${violated}" is denied`, cap)
		}
	}

	if (constraints.allowedFields?.length) {
		const extra = inputKeys.find((k) => !constraints.allowedFields?.includes(k))
		if (extra) {
			return deny('allowed-fields-violation', `field "${extra}" is not in allowedFields`, cap)
		}
	}

	return null
}

export function checkDataClass(
	token: CapabilityToken,
	dataClass: DataClass,
): CapabilityCheckResult {
	const denied = token.dataClasses?.denied?.includes(dataClass)
	if (denied) {
		return deny('denied-data-class', `data class "${dataClass}" is denied`)
	}
	const allowedList = token.dataClasses?.allowed
	if (allowedList?.length && !allowedList.includes(dataClass)) {
		return deny('denied-data-class', `data class "${dataClass}" is not in allowed list`)
	}
	return { allowed: true }
}

export interface CallToolOptions {
	input?: unknown
	dataClasses?: DataClass[]
}

export function canCallTool(
	token: CapabilityToken,
	toolName: string,
	options: CallToolOptions = {},
): CapabilityCheckResult {
	const cap = findToolCapability(token, toolName)
	if (!cap) {
		return deny('no-matching-capability', `no tool capability for "${toolName}"`)
	}

	for (const dataClass of options.dataClasses ?? []) {
		const dcResult = checkDataClass(token, dataClass)
		if (!dcResult.allowed) return { ...dcResult, matchedCapability: cap }
	}

	const fieldResult = checkFieldConstraints(cap, options.input)
	if (fieldResult) return fieldResult

	return allow(cap)
}

export interface CallLLMOptions {
	provider?: string
	model?: string
	estimatedCost?: number
	estimatedTokens?: number
}

function matchLLMCapability(cap: LLMCapability, opts: CallLLMOptions): boolean {
	if (cap.provider && opts.provider && cap.provider !== opts.provider) return false
	if (cap.models?.length && opts.model && !cap.models.includes(opts.model)) return false
	return true
}

export function canCallLLM(token: CapabilityToken, options: CallLLMOptions): CapabilityCheckResult {
	const caps = findLLMCapabilities(token)
	if (!caps.length) return deny('no-matching-capability', 'no LLM capability on token')

	const matched = caps.find((c) => matchLLMCapability(c, options))
	if (!matched) {
		return deny(
			'no-matching-capability',
			`no LLM capability matches provider=${options.provider} model=${options.model}`,
		)
	}

	if (matched.maxCost !== undefined && options.estimatedCost !== undefined) {
		if (options.estimatedCost > matched.maxCost) {
			return deny(
				'budget-exceeded',
				`estimatedCost ${options.estimatedCost} > ${matched.maxCost}`,
				matched,
			)
		}
	}
	if (matched.maxTokens !== undefined && options.estimatedTokens !== undefined) {
		if (options.estimatedTokens > matched.maxTokens) {
			return deny(
				'budget-exceeded',
				`estimatedTokens ${options.estimatedTokens} > ${matched.maxTokens}`,
				matched,
			)
		}
	}

	return allow(matched)
}

export interface QueryRagOptions {
	store?: string
	resultCount?: number
}

export function canQueryRag(
	token: CapabilityToken,
	options: QueryRagOptions,
): CapabilityCheckResult {
	const caps = findRagCapabilities(token)
	if (!caps.length) return deny('no-matching-capability', 'no RAG capability on token')

	const matched = caps.find(
		(c) => !c.stores?.length || (options.store && c.stores.includes(options.store)),
	)
	if (!matched) {
		return deny('no-matching-capability', `no RAG capability matches store=${options.store}`)
	}

	if (matched.maxResults !== undefined && options.resultCount !== undefined) {
		if (options.resultCount > matched.maxResults) {
			return deny(
				'budget-exceeded',
				`resultCount ${options.resultCount} > ${matched.maxResults}`,
				matched,
			)
		}
	}

	return allow(matched)
}

export interface UseMcpOptions {
	server: string
	tool: string
}

export function canUseMcp(token: CapabilityToken, options: UseMcpOptions): CapabilityCheckResult {
	const caps = findMcpCapabilities(token)
	if (!caps.length) return deny('no-matching-capability', 'no MCP capability on token')

	const matched = caps.find((c) => {
		if (c.server !== options.server) return false
		if (c.tools?.length && !c.tools.includes(options.tool)) return false
		return true
	})

	if (!matched) {
		return deny(
			'no-matching-capability',
			`no MCP capability matches server=${options.server} tool=${options.tool}`,
		)
	}

	return allow(matched)
}
