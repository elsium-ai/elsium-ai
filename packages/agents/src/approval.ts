import { generateId } from '@elsium-ai/core'

export interface ApprovalRequest {
	id: string
	type: 'tool_call' | 'model_access' | 'budget_exceed' | 'custom'
	description: string
	context: Record<string, unknown>
	requestedAt: number
}

export interface ApprovalDecision {
	requestId: string
	approved: boolean
	reason?: string
	decidedBy?: string
	decidedAt: number
}

export type ApprovalCallback = (request: ApprovalRequest) => Promise<ApprovalDecision>

export interface ApprovalGateConfig {
	callback: ApprovalCallback
	requireApprovalFor?: {
		tools?: string[] | boolean
		models?: string[]
		costThreshold?: number
	}
	timeoutMs?: number
	onTimeout?: 'deny' | 'allow'
}

export interface ApprovalGate {
	requestApproval(
		type: ApprovalRequest['type'],
		description: string,
		context: Record<string, unknown>,
	): Promise<ApprovalDecision>
	readonly pendingCount: number
}

export function createApprovalGate(config: ApprovalGateConfig): ApprovalGate {
	const timeoutMs = config.timeoutMs ?? 300_000
	const onTimeout = config.onTimeout ?? 'deny'
	let pendingCount = 0

	return {
		get pendingCount(): number {
			return pendingCount
		},

		async requestApproval(
			type: ApprovalRequest['type'],
			description: string,
			context: Record<string, unknown>,
		): Promise<ApprovalDecision> {
			const request: ApprovalRequest = {
				id: generateId('apr'),
				type,
				description,
				context,
				requestedAt: Date.now(),
			}

			pendingCount++

			let timer: ReturnType<typeof setTimeout> | undefined
			try {
				const callbackPromise = config.callback(request)

				const timeoutPromise = new Promise<ApprovalDecision>((resolve) => {
					timer = setTimeout(() => {
						resolve({
							requestId: request.id,
							approved: onTimeout === 'allow',
							reason: `Approval timed out after ${timeoutMs}ms`,
							decidedAt: Date.now(),
						})
					}, timeoutMs)
				})

				return await Promise.race([callbackPromise, timeoutPromise])
			} finally {
				if (timer !== undefined) clearTimeout(timer)
				pendingCount--
			}
		},
	}
}

export function shouldRequireApproval(
	config: ApprovalGateConfig['requireApprovalFor'],
	context: { toolName?: string; model?: string; cost?: number },
): boolean {
	if (!config) return false

	if (context.toolName && config.tools) {
		if (config.tools === true) return true
		if (Array.isArray(config.tools) && config.tools.includes(context.toolName)) return true
	}

	if (context.model && config.models?.includes(context.model)) return true

	if (
		context.cost !== undefined &&
		config.costThreshold !== undefined &&
		context.cost > config.costThreshold
	) {
		return true
	}

	return false
}
