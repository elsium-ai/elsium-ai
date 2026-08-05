import { ElsiumError, type Signer, generateId } from '@elsium-ai/core'
import { canonicalize, hashCanonical, hashText } from './canonical'
import {
	AIBOM_VERSION,
	type AiBom,
	type AiBomComponents,
	type DatasetComponent,
	type McpServerComponent,
	type ModelComponent,
	type PolicyComponent,
	type PromptComponent,
	type RuntimeComponent,
	type ThresholdValue,
	type ToolComponent,
} from './types'

/**
 * Source shapes are structural on purpose.
 *
 * `@elsium-ai/observe` depends on `core` alone. Accepting a `Tool` from
 * `@elsium-ai/tools` or a `DatasetManifest` from `@elsium-ai/testing` by
 * shape — rather than by import — keeps that edge intact while still
 * letting callers hand us the real objects they already hold.
 */

/** A prompt, either pre-hashed or as raw text we hash for you. */
export type PromptSource =
	| PromptComponent
	| { name: string; version?: string; content: string; variables?: string[] }

/** Structural match for `Tool` from @elsium-ai/tools. */
export interface ToolLike {
	name: string
	description?: string
	rawSchema?: Record<string, unknown>
	toDefinition?: () => { name: string; description: string; inputSchema: Record<string, unknown> }
	sideEffectLevel?: string
	sandbox?: { mode?: string; capabilities?: readonly string[] }
	/** Present on tools declaring `requireApproval` in their config. */
	requiresApproval?: boolean
	/** Caller-supplied hash of the handler source; we cannot read it ourselves. */
	handlerSha256?: string
}

export type ToolSource = ToolComponent | ToolLike

/** Structural match for `DatasetManifest` from @elsium-ai/testing. */
export type DatasetSource =
	| DatasetComponent
	| {
			name: string
			version?: string
			caseCount?: number
			contentHash: string
			annotatorAgreement?: number
			annotators?: string[]
	  }

/** A policy, either pre-hashed or as a document/bundle we canonicalize and hash. */
export type PolicySource =
	| PolicyComponent
	| { name: string; version?: string; document: unknown; mode?: string }

export interface AiBomInput {
	agentId: string
	agentVersion?: string
	/** Deployment environment — a BOM approved for staging is not approved for prod. */
	environment?: string
	models?: ModelComponent[]
	prompts?: PromptSource[]
	tools?: ToolSource[]
	mcpServers?: McpServerComponent[]
	datasets?: DatasetSource[]
	policies?: PolicySource[]
	thresholds?: Record<string, ThresholdValue>
	runtime?: RuntimeComponent
	metadata?: Record<string, unknown>
}

export interface GenerateAiBomOptions {
	signer: Signer
	clock?: () => number
	/** Override the generated id — useful for reproducible fixtures. */
	bomId?: string
}

function isPreHashedPrompt(source: PromptSource): source is PromptComponent {
	return typeof (source as PromptComponent).sha256 === 'string'
}

function isPreHashedTool(source: ToolSource): source is ToolComponent {
	return typeof (source as ToolComponent).schemaSha256 === 'string'
}

function isPreHashedDataset(source: DatasetSource): source is DatasetComponent {
	return typeof (source as DatasetComponent).contentSha256 === 'string'
}

function isPreHashedPolicy(source: PolicySource): source is PolicyComponent {
	return typeof (source as PolicyComponent).sha256 === 'string'
}

async function normalizePrompt(source: PromptSource): Promise<PromptComponent> {
	if (isPreHashedPrompt(source)) {
		return {
			name: source.name,
			version: source.version,
			sha256: source.sha256,
			variables: source.variables ? [...source.variables].sort() : undefined,
		}
	}
	return {
		name: source.name,
		version: source.version,
		sha256: await hashText(source.content),
		variables: source.variables ? [...source.variables].sort() : undefined,
	}
}

async function normalizeTool(source: ToolSource): Promise<ToolComponent> {
	if (isPreHashedTool(source)) {
		return {
			...source,
			capabilities: source.capabilities ? [...source.capabilities].sort() : undefined,
		}
	}

	const schema = source.rawSchema ?? source.toDefinition?.().inputSchema ?? {}
	const capabilities = source.sandbox?.capabilities
		? [...source.sandbox.capabilities].sort()
		: undefined

	return {
		name: source.name,
		description: source.description ?? source.toDefinition?.().description,
		schemaSha256: await hashCanonical(schema),
		handlerSha256: source.handlerSha256,
		sideEffectLevel: source.sideEffectLevel,
		capabilities,
		sandboxMode: source.sandbox?.mode,
		requiresApproval: source.requiresApproval,
	}
}

function normalizeDataset(source: DatasetSource): DatasetComponent {
	if (isPreHashedDataset(source)) {
		return { ...source, annotators: source.annotators ? [...source.annotators].sort() : undefined }
	}
	return {
		name: source.name,
		version: source.version,
		caseCount: source.caseCount,
		contentSha256: source.contentHash,
		annotatorAgreement: source.annotatorAgreement,
		annotators: source.annotators ? [...source.annotators].sort() : undefined,
	}
}

async function normalizePolicy(source: PolicySource): Promise<PolicyComponent> {
	if (isPreHashedPolicy(source)) return { ...source }
	return {
		name: source.name,
		version: source.version,
		sha256: await hashCanonical(source.document),
		mode: source.mode,
	}
}

/**
 * Sorting is what makes the BOM an identity rather than a log.
 *
 * Registration order is an accident of module evaluation; if it leaked into
 * the hash, moving a `defineTool` call would read as composition drift.
 */
function sortByKey<T>(items: T[], key: (item: T) => string): T[] {
	return [...items].sort((a, b) => key(a).localeCompare(key(b)))
}

function sortThresholds(
	thresholds: Record<string, ThresholdValue>,
): Record<string, ThresholdValue> {
	const sorted: Record<string, ThresholdValue> = {}
	for (const key of Object.keys(thresholds).sort()) sorted[key] = thresholds[key]
	return sorted
}

function assertUniqueNames(names: string[], kind: string): void {
	const seen = new Set<string>()
	for (const name of names) {
		if (seen.has(name)) {
			throw new ElsiumError({
				code: 'CONFIG_ERROR',
				message: `Duplicate ${kind} "${name}" in AI-BOM input — component identity must be unique within its kind`,
				retryable: false,
			})
		}
		seen.add(name)
	}
}

async function buildComponents(input: AiBomInput): Promise<AiBomComponents> {
	const prompts = await Promise.all((input.prompts ?? []).map(normalizePrompt))
	const tools = await Promise.all((input.tools ?? []).map(normalizeTool))
	const policies = await Promise.all((input.policies ?? []).map(normalizePolicy))
	const datasets = (input.datasets ?? []).map(normalizeDataset)

	assertUniqueNames(
		tools.map((t) => t.name),
		'tool',
	)
	assertUniqueNames(
		policies.map((p) => p.name),
		'policy',
	)
	assertUniqueNames(
		(input.mcpServers ?? []).map((s) => s.name),
		'MCP server',
	)

	return {
		models: sortByKey(input.models ?? [], (m) => `${m.provider}:${m.model}:${m.role ?? ''}`),
		prompts: sortByKey(prompts, (p) => `${p.name}@${p.version ?? ''}`),
		tools: sortByKey(tools, (t) => t.name),
		mcpServers: sortByKey(input.mcpServers ?? [], (s) => s.name),
		datasets: sortByKey(datasets, (d) => `${d.name}@${d.version ?? ''}`),
		policies: sortByKey(policies, (p) => `${p.name}@${p.version ?? ''}`),
		thresholds: sortThresholds(input.thresholds ?? {}),
		runtime: input.runtime,
	}
}

/** Header fields covered by `digest` alongside the component hash. */
function digestInput(
	header: Omit<AiBom, 'components' | 'digest' | 'signature'>,
): Record<string, unknown> {
	return {
		version: header.version,
		bomId: header.bomId,
		agentId: header.agentId,
		agentVersion: header.agentVersion,
		generatedAt: header.generatedAt,
		environment: header.environment,
		componentsHash: header.componentsHash,
		metadata: header.metadata,
	}
}

export function bomSigningPayload(bomId: string, digest: string): string {
	return `${AIBOM_VERSION}\n${bomId}\n${digest}`
}

/**
 * Produce a signed AI-BOM for an agent's current composition.
 *
 * Deterministic given the same input and `bomId`/`clock`: the same agent
 * regenerated on another machine yields the same `componentsHash`.
 */
export async function generateAiBom(
	input: AiBomInput,
	options: GenerateAiBomOptions,
): Promise<AiBom> {
	if (!input.agentId || typeof input.agentId !== 'string') {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'generateAiBom requires a non-empty agentId',
			retryable: false,
		})
	}
	if (!options?.signer) {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'generateAiBom requires a signer — an unsigned BOM proves nothing',
			retryable: false,
		})
	}

	const clock = options.clock ?? (() => Date.now())
	const components = await buildComponents(input)
	const componentsHash = await hashCanonical(components)

	const header = {
		version: AIBOM_VERSION,
		bomId: options.bomId ?? generateId('bom'),
		agentId: input.agentId,
		agentVersion: input.agentVersion,
		generatedAt: new Date(clock()).toISOString(),
		environment: input.environment,
		componentsHash,
		metadata: input.metadata,
	} satisfies Omit<AiBom, 'components' | 'digest' | 'signature'>

	const digest = await hashCanonical(digestInput(header))
	const signature = options.signer.sign(bomSigningPayload(header.bomId, digest))

	return { ...header, components, digest, signature }
}

/** Canonical serialization — what you write to disk and commit as the approved BOM. */
export function serializeAiBom(bom: AiBom): string {
	return canonicalize(bom)
}
