import type { Signer } from '../crypto/signer'
import { ElsiumError } from '../errors'
import { generateId } from '../utils'
import { tokenSigningPayload } from './issuer'
import type {
	AgentCapability,
	CapabilityBudget,
	CapabilityDataClasses,
	CapabilityToken,
	LLMCapability,
	McpCapability,
	RagCapability,
	ToolCapability,
} from './types'
import { CAPABILITY_TOKEN_VERSION } from './types'

export interface DelegateOptions {
	subject: { agent: string; runId?: string }
	capabilities: AgentCapability[]
	dataClasses?: CapabilityDataClasses
	budget?: CapabilityBudget
	ttlMs?: number
	expiresAt?: number
	notBefore?: number
	signer: Signer
}

function isSubsetArray<T>(child: T[] | undefined, parent: T[] | undefined): boolean {
	if (!parent?.length) return true
	if (!child?.length) return false
	return child.every((item) => parent.includes(item))
}

function lookupParentToolCap(parent: CapabilityToken, name: string): ToolCapability | undefined {
	return parent.capabilities.find((c): c is ToolCapability => c.kind === 'tool' && c.name === name)
}

function lookupParentLLMCaps(parent: CapabilityToken): LLMCapability[] {
	return parent.capabilities.filter((c): c is LLMCapability => c.kind === 'llm')
}

function lookupParentRagCaps(parent: CapabilityToken): RagCapability[] {
	return parent.capabilities.filter((c): c is RagCapability => c.kind === 'rag')
}

function lookupParentMcpCap(parent: CapabilityToken, server: string): McpCapability | undefined {
	return parent.capabilities.find(
		(c): c is McpCapability => c.kind === 'mcp' && c.server === server,
	)
}

function checkToolSubset(child: ToolCapability, parent: CapabilityToken): string | null {
	const parentCap = lookupParentToolCap(parent, child.name)
	if (!parentCap) return `tool "${child.name}" not in parent capabilities`

	const parentDenied = parentCap.constraints?.deniedFields ?? []
	const childDenied = child.constraints?.deniedFields ?? []
	if (parentDenied.some((f) => !childDenied.includes(f))) {
		return `child must inherit all parent deniedFields for tool "${child.name}"`
	}

	const parentAllowed = parentCap.constraints?.allowedFields
	const childAllowed = child.constraints?.allowedFields
	if (parentAllowed?.length) {
		if (!childAllowed?.length || !childAllowed.every((f) => parentAllowed.includes(f))) {
			return `child allowedFields must be a subset of parent for tool "${child.name}"`
		}
	}
	return null
}

function checkLLMSubset(child: LLMCapability, parent: CapabilityToken): string | null {
	const candidates = lookupParentLLMCaps(parent)
	if (!candidates.length) return 'parent has no LLM capability'

	const match = candidates.find((p) => {
		if (p.provider && child.provider && p.provider !== child.provider) return false
		if (p.models?.length && child.models?.length) {
			return child.models.every((m) => p.models?.includes(m))
		}
		return true
	})
	if (!match) return `no parent LLM capability covers child ${JSON.stringify(child)}`

	if (match.maxCost !== undefined) {
		if (child.maxCost === undefined || child.maxCost > match.maxCost) {
			return `child maxCost must be defined and ≤ parent maxCost (${match.maxCost})`
		}
	}
	if (match.maxTokens !== undefined) {
		if (child.maxTokens === undefined || child.maxTokens > match.maxTokens) {
			return `child maxTokens must be defined and ≤ parent maxTokens (${match.maxTokens})`
		}
	}
	return null
}

function checkRagSubset(child: RagCapability, parent: CapabilityToken): string | null {
	const candidates = lookupParentRagCaps(parent)
	if (!candidates.length) return 'parent has no RAG capability'

	const match = candidates.find((p) => {
		if (!p.stores?.length) return true
		if (!child.stores?.length) return false
		return child.stores.every((s) => p.stores?.includes(s))
	})
	if (!match) return `no parent RAG capability covers child stores=${JSON.stringify(child.stores)}`

	if (match.maxResults !== undefined) {
		if (child.maxResults === undefined || child.maxResults > match.maxResults) {
			return `child maxResults must be defined and ≤ parent maxResults (${match.maxResults})`
		}
	}
	return null
}

function checkMcpSubset(child: McpCapability, parent: CapabilityToken): string | null {
	const parentCap = lookupParentMcpCap(parent, child.server)
	if (!parentCap) return `mcp server "${child.server}" not in parent capabilities`

	if (parentCap.tools?.length) {
		if (!child.tools?.length || !child.tools.every((t) => parentCap.tools?.includes(t))) {
			return `child mcp tools must be a subset of parent for server "${child.server}"`
		}
	}
	return null
}

function checkCapabilitySubset(child: AgentCapability, parent: CapabilityToken): string | null {
	if (child.kind === 'tool') return checkToolSubset(child, parent)
	if (child.kind === 'llm') return checkLLMSubset(child, parent)
	if (child.kind === 'rag') return checkRagSubset(child, parent)
	if (child.kind === 'mcp') return checkMcpSubset(child, parent)
	if (child.kind === 'workflow') {
		const exists = parent.capabilities.some(
			(c) => c.kind === 'workflow' && (c.name === undefined || c.name === child.name),
		)
		return exists ? null : 'no parent workflow capability covers child'
	}
	return `unknown capability kind: ${(child as { kind: string }).kind}`
}

function checkDataClassSubset(
	child: CapabilityDataClasses | undefined,
	parent: CapabilityDataClasses | undefined,
): string | null {
	if (!parent) return null
	if (parent.denied?.length) {
		const childDenied = child?.denied ?? []
		if (parent.denied.some((d) => !childDenied.includes(d))) {
			return 'child must inherit all parent denied data classes'
		}
	}
	if (parent.allowed?.length) {
		const childAllowed = child?.allowed
		if (!childAllowed?.length || !isSubsetArray(childAllowed, parent.allowed)) {
			return 'child allowed data classes must be a subset of parent allowed list'
		}
	}
	return null
}

function checkBudgetSubset(
	child: CapabilityBudget | undefined,
	parent: CapabilityBudget | undefined,
): string | null {
	if (!parent) return null
	const checks: Array<[keyof CapabilityBudget, string]> = [
		['maxCost', 'maxCost'],
		['maxTokens', 'maxTokens'],
		['maxCalls', 'maxCalls'],
	]
	for (const [field, label] of checks) {
		const p = parent[field]
		if (p === undefined) continue
		const c = child?.[field]
		if (c === undefined || c > p) {
			return `child budget.${label} must be defined and ≤ parent (${p})`
		}
	}
	return null
}

function resolveDelegationValidity(
	now: number,
	parent: CapabilityToken,
	options: DelegateOptions,
): { issuedAt: number; expiresAt: number; notBefore?: number } {
	const ttl = options.ttlMs ?? parent.validity.expiresAt - now
	const expiresAt = options.expiresAt ?? Math.min(parent.validity.expiresAt, now + ttl)
	if (expiresAt <= now) {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'derived expiresAt is not in the future',
			retryable: false,
		})
	}
	if (expiresAt > parent.validity.expiresAt) {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'child expiresAt cannot exceed parent expiresAt',
			retryable: false,
		})
	}
	if (options.notBefore !== undefined && options.notBefore >= expiresAt) {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'notBefore must be less than expiresAt',
			retryable: false,
		})
	}
	return { issuedAt: now, expiresAt, notBefore: options.notBefore }
}

export function delegateToken(
	parent: CapabilityToken,
	options: DelegateOptions,
	clock: () => number = () => Date.now(),
): CapabilityToken {
	if (!options.capabilities?.length) {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'delegate requires at least one capability',
			retryable: false,
		})
	}

	for (const cap of options.capabilities) {
		const violation = checkCapabilitySubset(cap, parent)
		if (violation) {
			throw new ElsiumError({
				code: 'CONFIG_ERROR',
				message: `child capability is not a subset of parent: ${violation}`,
				retryable: false,
				metadata: { offending: cap },
			})
		}
	}

	const dcViolation = checkDataClassSubset(options.dataClasses, parent.dataClasses)
	if (dcViolation) {
		throw new ElsiumError({ code: 'CONFIG_ERROR', message: dcViolation, retryable: false })
	}

	const budgetViolation = checkBudgetSubset(options.budget, parent.budget)
	if (budgetViolation) {
		throw new ElsiumError({ code: 'CONFIG_ERROR', message: budgetViolation, retryable: false })
	}

	const now = clock()
	const validity = resolveDelegationValidity(now, parent, options)
	const tokenId = `cap_${generateId('').slice(1)}`

	const unsigned: Omit<CapabilityToken, 'signature'> = {
		version: CAPABILITY_TOKEN_VERSION,
		tokenId,
		issuer: { orgId: parent.issuer.orgId, keyId: options.signer.keyId },
		subject: {
			agent: options.subject.agent,
			runId: options.subject.runId,
			parentToken: parent.tokenId,
		},
		capabilities: options.capabilities,
		dataClasses: options.dataClasses ?? parent.dataClasses,
		budget: options.budget ?? parent.budget,
		validity,
	}

	const signature = options.signer.sign(tokenSigningPayload(unsigned))
	return { ...unsigned, signature }
}
