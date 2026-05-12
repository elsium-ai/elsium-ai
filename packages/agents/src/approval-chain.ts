/**
 * Multi-stage approval chain (G4).
 *
 * Builds on the legacy single-callback ApprovalGate (./approval.ts) by adding:
 *  - Sequential stages with per-stage enter conditions.
 *  - Per-stage approvers (role-based or callback-based).
 *  - Timeout per stage with deny/escalate/allow outcomes.
 *  - Pluggable persistence via ApprovalStore (port).
 *  - Optional notifier hook for Slack/email/PagerDuty integrations.
 *
 * Persistence note: this package ships ONLY the in-memory reference
 * adapter. Production durability is the user's call — implement
 * ApprovalStore against your chosen backend (SQLite, Postgres, Redis,
 * DynamoDB, etc.). See docs/guides/persistent-stores.md for copy-paste
 * templates.
 */

import { ElsiumError, generateId } from '@elsium-ai/core'
import type { ApprovalCallback, ApprovalDecision, ApprovalRequest } from './approval'

// ─── Stage definition ───────────────────────────────────────────

export type ApprovalStageStatus = 'pending' | 'approved' | 'denied' | 'skipped' | 'expired'

export interface StageState {
	readonly name: string
	readonly status: ApprovalStageStatus
	readonly decision?: ApprovalDecision
	readonly enteredAt?: number
	readonly resolvedAt?: number
}

export type ChainStatus = 'pending' | 'approved' | 'denied' | 'expired'

export interface ApprovalState {
	readonly request: ApprovalRequest
	readonly stages: readonly StageState[]
	readonly currentStage: number
	readonly status: ChainStatus
	readonly createdAt: number
	readonly updatedAt: number
}

export interface ApprovalStage {
	readonly name: string
	/**
	 * Predicate to decide whether the stage applies to this request.
	 * Returning false skips the stage; true means it must be resolved
	 * before the chain advances.
	 */
	readonly enter: (req: ApprovalRequest) => boolean
	readonly approver: ApproverSpec
	/** Default 5 min. */
	readonly timeoutMs?: number
	/** What to do when the stage timeout fires. Default: deny. */
	readonly onTimeout?: 'deny' | 'escalate' | 'allow'
}

export type ApproverSpec =
	| { readonly type: 'role'; readonly target: string }
	| { readonly type: 'user'; readonly target: string }
	| { readonly type: 'callback'; readonly target: ApprovalCallback }

// ─── Store (port) ───────────────────────────────────────────────

export interface ApprovalStoreFilter {
	readonly stage?: string
	readonly role?: string
	readonly status?: ChainStatus
}

export interface ApprovalStore {
	put(state: ApprovalState): Promise<void>
	get(requestId: string): Promise<ApprovalState | null>
	listPending(filter?: ApprovalStoreFilter): Promise<readonly ApprovalState[]>
	resolveStage(
		requestId: string,
		stageName: string,
		decision: ApprovalDecision,
	): Promise<ApprovalState>
}

// ─── In-memory reference adapter ────────────────────────────────

function matchesApprovalFilter(state: ApprovalState, filter?: ApprovalStoreFilter): boolean {
	const expectedStatus = filter?.status ?? 'pending'
	if (state.status !== expectedStatus) return false
	if (!filter?.stage) return true
	const stage = state.stages[state.currentStage]
	return !!stage && stage.name === filter.stage
}

export function createInMemoryApprovalStore(): ApprovalStore {
	const records = new Map<string, ApprovalState>()

	function copyStages(stages: readonly StageState[]): StageState[] {
		return stages.map((s) => ({ ...s, decision: s.decision ? { ...s.decision } : undefined }))
	}

	function clone(state: ApprovalState): ApprovalState {
		return {
			...state,
			stages: copyStages(state.stages),
			request: { ...state.request, context: { ...state.request.context } },
		}
	}

	return {
		async put(state: ApprovalState): Promise<void> {
			records.set(state.request.id, clone(state))
		},

		async get(requestId: string): Promise<ApprovalState | null> {
			const s = records.get(requestId)
			return s ? clone(s) : null
		},

		async listPending(filter?: ApprovalStoreFilter): Promise<readonly ApprovalState[]> {
			const result: ApprovalState[] = []
			for (const state of records.values()) {
				if (matchesApprovalFilter(state, filter)) result.push(clone(state))
			}
			return result
		},

		async resolveStage(
			requestId: string,
			stageName: string,
			decision: ApprovalDecision,
		): Promise<ApprovalState> {
			const existing = records.get(requestId)
			if (!existing) {
				throw ElsiumError.validation(`Approval request "${requestId}" not found`)
			}
			const stageIdx = existing.stages.findIndex((s) => s.name === stageName)
			if (stageIdx === -1) {
				throw ElsiumError.validation(
					`Stage "${stageName}" not found in approval request "${requestId}"`,
				)
			}
			const stage = existing.stages[stageIdx]
			if (stage.status !== 'pending') {
				throw ElsiumError.validation(
					`Stage "${stageName}" already resolved with status "${stage.status}"`,
				)
			}

			const stages = copyStages(existing.stages)
			stages[stageIdx] = {
				...stage,
				status: decision.approved ? 'approved' : 'denied',
				decision: { ...decision },
				resolvedAt: Date.now(),
			}

			const next: ApprovalState = {
				...existing,
				stages,
				updatedAt: Date.now(),
			}
			records.set(requestId, clone(next))
			return clone(next)
		},
	}
}

// ─── Notifier (port, optional) ──────────────────────────────────

export interface ApprovalNotifier {
	notify(state: ApprovalState, stage: StageState): Promise<void>
}

// ─── Chain ──────────────────────────────────────────────────────

export interface ApprovalChainConfig {
	readonly stages: readonly ApprovalStage[]
	readonly store: ApprovalStore
	readonly notifier?: ApprovalNotifier
}

export interface ApprovalChain {
	request(req: Omit<ApprovalRequest, 'id' | 'requestedAt'>): Promise<ApprovalState>
	resume(requestId: string): Promise<ApprovalState>
	cancel(requestId: string, reason: string): Promise<ApprovalState>
	readonly store: ApprovalStore
}

function validateStages(stages: readonly ApprovalStage[]): void {
	if (stages.length === 0) {
		throw ElsiumError.validation('ApprovalChain requires at least one stage')
	}
	const names = new Set<string>()
	for (const s of stages) {
		if (names.has(s.name)) {
			throw ElsiumError.validation(`Duplicate stage name "${s.name}" in ApprovalChain`)
		}
		names.add(s.name)
	}
}

function buildInitialStages(
	chainStages: readonly ApprovalStage[],
	req: ApprovalRequest,
): StageState[] {
	return chainStages.map((s) => ({
		name: s.name,
		status: s.enter(req) ? ('pending' as const) : ('skipped' as const),
	}))
}

function firstActiveStageIndex(stages: readonly StageState[]): number {
	for (let i = 0; i < stages.length; i++) {
		if (stages[i].status === 'pending') return i
	}
	return stages.length
}

async function invokeCallbackApprover(
	stage: ApprovalStage,
	request: ApprovalRequest,
): Promise<ApprovalDecision> {
	if (stage.approver.type !== 'callback') {
		// Non-callback approvers must be resolved externally (via store.resolveStage).
		throw ElsiumError.validation(
			`Stage "${stage.name}" has approver type "${stage.approver.type}"; cannot be auto-invoked. Resolve via store.resolveStage from the approving role's UI.`,
		)
	}
	return stage.approver.target(request)
}

async function runStageWithTimeout(
	stage: ApprovalStage,
	request: ApprovalRequest,
): Promise<ApprovalDecision | { timedOut: true }> {
	const timeoutMs = stage.timeoutMs ?? 300_000
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		const decisionPromise = invokeCallbackApprover(stage, request)
		const timeoutPromise = new Promise<{ timedOut: true }>((resolve) => {
			timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs)
		})
		return await Promise.race([decisionPromise, timeoutPromise])
	} finally {
		if (timer !== undefined) clearTimeout(timer)
	}
}

function deriveChainStatus(stages: readonly StageState[]): ChainStatus {
	let sawPending = false
	for (const s of stages) {
		if (s.status === 'denied' || s.status === 'expired')
			return s.status === 'expired' ? 'expired' : 'denied'
		if (s.status === 'pending') sawPending = true
	}
	return sawPending ? 'pending' : 'approved'
}

async function advanceChain(
	chainStages: readonly ApprovalStage[],
	state: ApprovalState,
	store: ApprovalStore,
	notifier: ApprovalNotifier | undefined,
): Promise<ApprovalState> {
	let current = state
	while (current.status === 'pending') {
		const idx = current.currentStage
		const stage = current.stages[idx]
		if (!stage || stage.status !== 'pending') {
			// Either chain finished or current is non-pending — recompute status
			const status = deriveChainStatus(current.stages)
			current = { ...current, status, updatedAt: Date.now() }
			await store.put(current)
			return current
		}

		const stageDef = chainStages[idx]
		// Mark entered if first time
		if (stage.enteredAt === undefined) {
			const stages = current.stages.map((s, i) => (i === idx ? { ...s, enteredAt: Date.now() } : s))
			current = { ...current, stages, updatedAt: Date.now() }
			await store.put(current)
			if (notifier) await notifier.notify(current, stages[idx])
		}

		// Only auto-resolve callback approvers; role/user types are waited on by external action.
		if (stageDef.approver.type !== 'callback') {
			return current
		}

		const outcome = await runStageWithTimeout(stageDef, current.request)
		if ('timedOut' in outcome) {
			current = await applyTimeout(chainStages, current, idx, store)
		} else {
			current = await store.resolveStage(current.request.id, stage.name, outcome)
			current = await postResolve(chainStages, current, store)
		}
	}
	return current
}

async function applyTimeout(
	chainStages: readonly ApprovalStage[],
	state: ApprovalState,
	stageIdx: number,
	store: ApprovalStore,
): Promise<ApprovalState> {
	const def = chainStages[stageIdx]
	const onTimeout = def.onTimeout ?? 'deny'
	const stage = state.stages[stageIdx]
	const now = Date.now()

	if (onTimeout === 'allow') {
		const decision: ApprovalDecision = {
			requestId: state.request.id,
			approved: true,
			reason: `Stage "${stage.name}" timed out — onTimeout=allow`,
			decidedAt: now,
		}
		const resolved = await store.resolveStage(state.request.id, stage.name, decision)
		return postResolve(chainStages, resolved, store)
	}

	if (onTimeout === 'deny') {
		const stages = state.stages.map((s, i) =>
			i === stageIdx ? { ...s, status: 'expired' as const, resolvedAt: now } : s,
		)
		const next: ApprovalState = {
			...state,
			stages,
			status: 'expired',
			updatedAt: now,
		}
		await store.put(next)
		return next
	}

	// escalate
	const stages = state.stages.map((s, i) =>
		i === stageIdx ? { ...s, status: 'skipped' as const, resolvedAt: now } : s,
	)
	const next: ApprovalState = {
		...state,
		stages,
		currentStage: firstActiveStageIndex(stages),
		updatedAt: now,
	}
	const status = deriveChainStatus(stages)
	const finalNext: ApprovalState = {
		...next,
		status,
	}
	await store.put(finalNext)
	return finalNext
}

async function postResolve(
	chainStages: readonly ApprovalStage[],
	state: ApprovalState,
	store: ApprovalStore,
): Promise<ApprovalState> {
	void chainStages
	const status = deriveChainStatus(state.stages)
	if (status !== 'pending') {
		const next: ApprovalState = { ...state, status, updatedAt: Date.now() }
		await store.put(next)
		return next
	}
	const nextIdx = firstActiveStageIndex(state.stages)
	const next: ApprovalState = {
		...state,
		currentStage: nextIdx,
		updatedAt: Date.now(),
	}
	await store.put(next)
	return next
}

export function createApprovalChain(config: ApprovalChainConfig): ApprovalChain {
	validateStages(config.stages)

	return {
		store: config.store,

		async request(req): Promise<ApprovalState> {
			const fullReq: ApprovalRequest = {
				...req,
				id: generateId('apr'),
				requestedAt: Date.now(),
			}
			const stages = buildInitialStages(config.stages, fullReq)
			const initial: ApprovalState = {
				request: fullReq,
				stages,
				currentStage: firstActiveStageIndex(stages),
				status: deriveChainStatus(stages),
				createdAt: Date.now(),
				updatedAt: Date.now(),
			}
			await config.store.put(initial)
			return advanceChain(config.stages, initial, config.store, config.notifier)
		},

		async resume(requestId: string): Promise<ApprovalState> {
			const existing = await config.store.get(requestId)
			if (!existing) {
				throw ElsiumError.validation(`Approval request "${requestId}" not found`)
			}
			if (existing.status !== 'pending') return existing
			const restarted = await postResolve(config.stages, existing, config.store)
			return advanceChain(config.stages, restarted, config.store, config.notifier)
		},

		async cancel(requestId: string, reason: string): Promise<ApprovalState> {
			const existing = await config.store.get(requestId)
			if (!existing) {
				throw ElsiumError.validation(`Approval request "${requestId}" not found`)
			}
			const now = Date.now()
			const stages = existing.stages.map((s) =>
				s.status === 'pending' ? { ...s, status: 'denied' as const, resolvedAt: now } : s,
			)
			const next: ApprovalState = {
				...existing,
				stages,
				status: 'denied',
				updatedAt: now,
				request: {
					...existing.request,
					context: { ...existing.request.context, cancellationReason: reason },
				},
			}
			await config.store.put(next)
			return next
		},
	}
}
