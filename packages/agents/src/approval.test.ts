import { describe, expect, it, vi } from 'vitest'
import { createApprovalGate, shouldRequireApproval } from './approval'
import type { ApprovalDecision, ApprovalRequest } from './approval'

describe('ApprovalGate', () => {
	it('calls callback with approval request', async () => {
		const callback = vi.fn(
			async (req: ApprovalRequest): Promise<ApprovalDecision> => ({
				requestId: req.id,
				approved: true,
				reason: 'Approved by admin',
				decidedBy: 'admin',
				decidedAt: Date.now(),
			}),
		)

		const gate = createApprovalGate({ callback })
		const decision = await gate.requestApproval('tool_call', 'Execute search tool', {
			tool: 'search',
		})

		expect(callback).toHaveBeenCalledOnce()
		expect(decision.approved).toBe(true)
		expect(decision.reason).toBe('Approved by admin')
	})

	it('returns denial decision', async () => {
		const gate = createApprovalGate({
			callback: async (req) => ({
				requestId: req.id,
				approved: false,
				reason: 'Too risky',
				decidedAt: Date.now(),
			}),
		})

		const decision = await gate.requestApproval('tool_call', 'Delete records', {})
		expect(decision.approved).toBe(false)
		expect(decision.reason).toBe('Too risky')
	})

	it('times out with deny by default', async () => {
		const gate = createApprovalGate({
			callback: async () => {
				await new Promise((r) => setTimeout(r, 5000))
				return { requestId: '', approved: true, decidedAt: Date.now() }
			},
			timeoutMs: 50,
			onTimeout: 'deny',
		})

		const decision = await gate.requestApproval('tool_call', 'test', {})
		expect(decision.approved).toBe(false)
		expect(decision.reason).toContain('timed out')
	})

	it('times out with allow when configured', async () => {
		const gate = createApprovalGate({
			callback: async () => {
				await new Promise((r) => setTimeout(r, 5000))
				return { requestId: '', approved: false, decidedAt: Date.now() }
			},
			timeoutMs: 50,
			onTimeout: 'allow',
		})

		const decision = await gate.requestApproval('tool_call', 'test', {})
		expect(decision.approved).toBe(true)
	})

	it('tracks pending count', async () => {
		let resolveCallback: (d: ApprovalDecision) => void

		const gate = createApprovalGate({
			callback: async (req) => {
				return new Promise<ApprovalDecision>((r) => {
					resolveCallback = r
				})
			},
		})

		expect(gate.pendingCount).toBe(0)

		const promise = gate.requestApproval('tool_call', 'test', {})

		// Allow microtask
		await new Promise((r) => setTimeout(r, 10))
		expect(gate.pendingCount).toBe(1)

		resolveCallback?.({ requestId: '', approved: true, decidedAt: Date.now() })
		await promise

		expect(gate.pendingCount).toBe(0)
	})

	it('request has correct structure', async () => {
		let capturedRequest: ApprovalRequest | null = null

		const gate = createApprovalGate({
			callback: async (req) => {
				capturedRequest = req
				return { requestId: req.id, approved: true, decidedAt: Date.now() }
			},
		})

		await gate.requestApproval('budget_exceed', 'Cost too high', { amount: 100 })

		expect(capturedRequest).not.toBeNull()
		expect(capturedRequest?.type).toBe('budget_exceed')
		expect(capturedRequest?.description).toBe('Cost too high')
		expect(capturedRequest?.context).toEqual({ amount: 100 })
		expect(capturedRequest?.id).toMatch(/^apr_/)
		expect(capturedRequest?.requestedAt).toBeGreaterThan(0)
	})
})

describe('shouldRequireApproval', () => {
	it('returns false with no config', () => {
		expect(shouldRequireApproval(undefined, { toolName: 'search' })).toBe(false)
	})

	it('matches specific tool names', () => {
		const config = { tools: ['delete', 'destroy'] }
		expect(shouldRequireApproval(config, { toolName: 'delete' })).toBe(true)
		expect(shouldRequireApproval(config, { toolName: 'search' })).toBe(false)
	})

	it('matches all tools when tools is true', () => {
		const config = { tools: true as const }
		expect(shouldRequireApproval(config, { toolName: 'anything' })).toBe(true)
	})

	it('matches specific models', () => {
		const config = { models: ['gpt-4o'] }
		expect(shouldRequireApproval(config, { model: 'gpt-4o' })).toBe(true)
		expect(shouldRequireApproval(config, { model: 'gpt-3.5' })).toBe(false)
	})

	it('matches cost threshold', () => {
		const config = { costThreshold: 1.0 }
		expect(shouldRequireApproval(config, { cost: 2.0 })).toBe(true)
		expect(shouldRequireApproval(config, { cost: 0.5 })).toBe(false)
	})

	it('returns false when context does not match', () => {
		const config = { tools: ['delete'], models: ['gpt-4o'] }
		expect(shouldRequireApproval(config, { toolName: 'search', model: 'gpt-3.5' })).toBe(false)
	})
})
