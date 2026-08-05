import type { Signature } from '@elsium-ai/core'

export const AIBOM_VERSION = 'elsium-aibom/v1' as const

/**
 * The kinds of component an AI-BOM declares.
 *
 * These are the things that actually determine agent behaviour. An npm
 * lockfile pins `zod@3.24.0`; it says nothing about which model answers,
 * which prompt steers it, or which tools it may invoke. Those are the
 * real dependencies of an AI system, so those are what we enumerate.
 */
export type ComponentKind =
	| 'model'
	| 'prompt'
	| 'tool'
	| 'mcpServer'
	| 'dataset'
	| 'policy'
	| 'threshold'
	| 'runtime'

export interface ModelComponent {
	provider: string
	model: string
	/**
	 * Provider-reported build identity (OpenAI `system_fingerprint` and
	 * equivalents). Providers reship models behind a stable name, so the
	 * name alone does not identify what actually served the request.
	 */
	fingerprint?: string
	/** Deployment region — material for jurisdiction-bound workloads. */
	region?: string
	/** Where in the system this model sits: primary, fallback, judge, classifier… */
	role?: string
}

export interface PromptComponent {
	name: string
	version?: string
	/** SHA-256 of the prompt text. */
	sha256: string
	variables?: string[]
}

export interface ToolComponent {
	name: string
	description?: string
	/** SHA-256 of the canonicalized input schema. */
	schemaSha256: string
	/** SHA-256 of the handler source, when the caller can supply it. */
	handlerSha256?: string
	sideEffectLevel?: string
	/** Sandbox capabilities the tool declares (`network:…`, `fs:read:…`). */
	capabilities?: string[]
	sandboxMode?: string
	requiresApproval?: boolean
}

export interface McpServerComponent {
	name: string
	transport: string
	/** SHA-256 of the server tool manifest — see `generateManifest()` in @elsium-ai/mcp. */
	manifestSha256?: string
	toolCount?: number
	allowedTools?: string[]
}

export interface DatasetComponent {
	name: string
	version?: string
	caseCount?: number
	/** SHA-256 of the canonical dataset content. */
	contentSha256: string
	/** Mean inter-annotator agreement (0..1), when the dataset was human-labelled. */
	annotatorAgreement?: number
	annotators?: string[]
}

export interface PolicyComponent {
	name: string
	version?: string
	/** SHA-256 of the policy document or bundle. */
	sha256: string
	/** `enforce` vs `monitor` — a policy demoted to monitor is a control change. */
	mode?: string
}

export interface RuntimeComponent {
	framework?: string
	frameworkVersion?: string
	runtime?: string
	packages?: Array<{ name: string; version: string }>
}

/** Numeric or categorical knobs that gate behaviour (confidence floors, cost caps…). */
export type ThresholdValue = string | number | boolean

export interface AiBomComponents {
	models: ModelComponent[]
	prompts: PromptComponent[]
	tools: ToolComponent[]
	mcpServers: McpServerComponent[]
	datasets: DatasetComponent[]
	policies: PolicyComponent[]
	thresholds: Record<string, ThresholdValue>
	runtime?: RuntimeComponent
}

/**
 * A signed declaration of what an agent is made of.
 *
 * Two guarantees:
 *  - `componentsHash` covers the component set, so composition cannot change
 *    without the hash changing.
 *  - `digest` covers the header *and* `componentsHash`, and is what gets
 *    signed — so agentId, version, environment and timestamp are equally
 *    tamper-evident.
 */
export interface AiBom {
	version: typeof AIBOM_VERSION
	bomId: string
	agentId: string
	agentVersion?: string
	/** ISO-8601. */
	generatedAt: string
	environment?: string
	components: AiBomComponents
	componentsHash: string
	digest: string
	signature: Signature
	metadata?: Record<string, unknown>
}

export interface VerifyAiBomResult {
	valid: boolean
	signatureValid: boolean
	/** `components` still hashes to the recorded `componentsHash`. */
	componentsHashValid: boolean
	/** The header + componentsHash still hash to the recorded `digest`. */
	digestValid: boolean
	/**
	 * Which checks actually ran.
	 *
	 * Verification stops at the innermost failure, so a `false` above may mean
	 * "failed" or "never evaluated". Consult this to tell them apart — reporting
	 * an unevaluated signature as invalid would misstate what was proven.
	 */
	checked: {
		componentsHash: boolean
		digest: boolean
		signature: boolean
	}
	reason?: string
}

// ─── Composition drift ──────────────────────────────────────────

export type DriftSeverity = 'critical' | 'major' | 'minor'
export type DriftKind = 'added' | 'removed' | 'changed'

export interface ComponentDrift {
	kind: DriftKind
	componentKind: ComponentKind
	/** Stable identity of the component within its kind (e.g. tool name). */
	id: string
	severity: DriftSeverity
	/** Which field changed, for `kind: 'changed'`. */
	field?: string
	approved?: unknown
	current?: unknown
	reason: string
}

export interface AiBomDiff {
	identical: boolean
	drifts: ComponentDrift[]
	counts: Record<DriftSeverity, number>
	highestSeverity: DriftSeverity | null
}
