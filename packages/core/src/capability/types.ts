import type { Signature } from '../crypto/signer'

export const CAPABILITY_TOKEN_VERSION = 'elsium-cap/v1' as const
export type CapabilityTokenVersion = typeof CAPABILITY_TOKEN_VERSION

export type DataClass = string

export interface ToolCapability {
	kind: 'tool'
	name: string
	constraints?: {
		allowedFields?: string[]
		deniedFields?: string[]
	}
}

export interface McpCapability {
	kind: 'mcp'
	server: string
	tools?: string[]
}

export interface LLMCapability {
	kind: 'llm'
	provider?: string
	models?: string[]
	maxCost?: number
	maxTokens?: number
}

export interface RagCapability {
	kind: 'rag'
	stores?: string[]
	maxResults?: number
}

export interface WorkflowCapability {
	kind: 'workflow'
	name?: string
}

export type AgentCapability =
	| ToolCapability
	| McpCapability
	| LLMCapability
	| RagCapability
	| WorkflowCapability

export interface CapabilityBudget {
	maxCost?: number
	maxTokens?: number
	maxCalls?: number
}

export interface CapabilityValidity {
	issuedAt: number
	expiresAt: number
	notBefore?: number
}

export interface CapabilityIssuerRef {
	orgId: string
	keyId: string
}

export interface CapabilitySubject {
	agent: string
	runId?: string
	parentToken?: string
}

export interface CapabilityDataClasses {
	allowed?: DataClass[]
	denied?: DataClass[]
}

export interface CapabilityToken {
	version: CapabilityTokenVersion
	tokenId: string
	issuer: CapabilityIssuerRef
	subject: CapabilitySubject
	capabilities: AgentCapability[]
	dataClasses?: CapabilityDataClasses
	budget?: CapabilityBudget
	validity: CapabilityValidity
	signature: Signature
}

export type CapabilityCheckReason =
	| 'expired'
	| 'not-yet-valid'
	| 'bad-signature'
	| 'unknown-key'
	| 'malformed'
	| 'no-matching-capability'
	| 'denied-data-class'
	| 'denied-field'
	| 'allowed-fields-violation'
	| 'budget-exceeded'

export interface CapabilityCheckResult {
	allowed: boolean
	reason?: CapabilityCheckReason
	detail?: string
	matchedCapability?: AgentCapability
}
