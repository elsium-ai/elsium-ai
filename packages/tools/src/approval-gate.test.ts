import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineTool } from './define'

const inputSchema = z.object({ amount: z.number() })

describe('tool approval gate', () => {
	it('skips approval when sideEffectLevel is not destructive and requireApproval is auto (default)', async () => {
		const handler = vi.fn().mockResolvedValue({ ok: true })
		const tool = defineTool({
			name: 'read_balance',
			description: '',
			input: inputSchema,
			sideEffectLevel: 'read',
			handler,
		})
		const approval = vi.fn()
		const result = await tool.execute({ amount: 1 }, { requestApproval: approval })
		expect(result.success).toBe(true)
		expect(handler).toHaveBeenCalled()
		expect(approval).not.toHaveBeenCalled()
	})

	it('calls approval handler for destructive tools (auto)', async () => {
		const handler = vi.fn().mockResolvedValue({ ok: true })
		const approval = vi.fn().mockResolvedValue({ status: 'approved' as const })
		const tool = defineTool({
			name: 'destroy_world',
			description: '',
			input: inputSchema,
			sideEffectLevel: 'destructive',
			handler,
		})
		const result = await tool.execute({ amount: 1 }, { requestApproval: approval })
		expect(approval).toHaveBeenCalledOnce()
		expect(result.success).toBe(true)
		expect(handler).toHaveBeenCalled()
	})

	it('blocks handler when approval is rejected', async () => {
		const handler = vi.fn().mockResolvedValue({ ok: true })
		const approval = vi.fn().mockResolvedValue({
			status: 'rejected' as const,
			reason: 'budget exceeded',
		})
		const tool = defineTool({
			name: 'transfer',
			description: '',
			input: inputSchema,
			sideEffectLevel: 'destructive',
			handler,
		})
		const result = await tool.execute({ amount: 100 }, { requestApproval: approval })
		expect(result.success).toBe(false)
		expect(result.approvalDenied).toBe(true)
		expect(result.approvalReason).toBe('budget exceeded')
		expect(handler).not.toHaveBeenCalled()
	})

	it('respects requireApproval: "always" even for read tools', async () => {
		const handler = vi.fn().mockResolvedValue({ ok: true })
		const approval = vi.fn().mockResolvedValue({ status: 'approved' as const })
		const tool = defineTool({
			name: 'read_pii',
			description: '',
			input: inputSchema,
			sideEffectLevel: 'read',
			requireApproval: 'always',
			handler,
		})
		await tool.execute({ amount: 1 }, { requestApproval: approval })
		expect(approval).toHaveBeenCalled()
	})

	it('respects requireApproval: "never" even for destructive tools', async () => {
		const handler = vi.fn().mockResolvedValue({ ok: true })
		const approval = vi.fn()
		const tool = defineTool({
			name: 'wipe_test_env',
			description: '',
			input: inputSchema,
			sideEffectLevel: 'destructive',
			requireApproval: 'never',
			handler,
		})
		await tool.execute({ amount: 1 }, { requestApproval: approval })
		expect(approval).not.toHaveBeenCalled()
		expect(handler).toHaveBeenCalled()
	})

	it('skips approval in dryRun mode', async () => {
		const approval = vi.fn()
		const tool = defineTool({
			name: 'transfer',
			description: '',
			input: inputSchema,
			sideEffectLevel: 'destructive',
			dryRunHandler: (input) => ({ preview: input.amount }),
			handler: async (input) => ({ done: input.amount }),
		})
		const result = await tool.execute({ amount: 50 }, { dryRun: true, requestApproval: approval })
		expect(approval).not.toHaveBeenCalled()
		expect(result.dryRun).toBe(true)
	})

	it('proceeds with a warning when destructive but no approval handler is provided', async () => {
		const handler = vi.fn().mockResolvedValue({ ok: true })
		const tool = defineTool({
			name: 'destroy',
			description: '',
			input: inputSchema,
			sideEffectLevel: 'destructive',
			handler,
		})
		const result = await tool.execute({ amount: 1 })
		expect(result.success).toBe(true)
		expect(handler).toHaveBeenCalled()
	})
})
