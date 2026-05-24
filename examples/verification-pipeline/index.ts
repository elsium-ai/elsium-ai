/**
 * Example: Verification-Augmented Generation (VAG)
 *
 * generate → validate → repair-or-abort with semantic repair prompts.
 *
 * Usage:
 *   export ANTHROPIC_API_KEY=your-key
 *   bun examples/verification-pipeline/index.ts
 */

import { externalValidator, runWithVerification, zodValidator } from '@elsium-ai/agents'
import { env } from '@elsium-ai/core'
import { gateway } from '@elsium-ai/gateway'
import { z } from 'zod'

const InvoiceSchema = z.object({
	vendor: z.string(),
	lineItems: z.array(z.object({ description: z.string(), amount: z.number().positive() })),
	total: z.number().positive(),
})

const sumMatches = externalValidator(
	async (invoice: z.infer<typeof InvoiceSchema>) => {
		const sum = invoice.lineItems.reduce((s, item) => s + item.amount, 0)
		const ok = Math.abs(sum - invoice.total) < 0.01
		return {
			valid: ok,
			reason: ok ? undefined : `total ${invoice.total} ≠ sum of line items ${sum}`,
		}
	},
	{
		name: 'sum-matches',
		repairHint: 'Set `total` equal to the sum of `lineItems[].amount`.',
	},
)

const validators = [zodValidator(InvoiceSchema), sumMatches]

const llm = gateway({ provider: 'anthropic', apiKey: env('ANTHROPIC_API_KEY') })

const baseMessages = [
	{
		role: 'user' as const,
		content:
			'Extract this invoice as JSON with vendor, lineItems (description + amount), and total: "Acme Corp: 2 widgets at $50, 1 gadget at $120. Total: $200."',
	},
]

const outcome = await runWithVerification(
	async (repair) => {
		const messages = [
			...baseMessages,
			...(repair ? [{ role: 'user' as const, content: repair.repairPrompt }] : []),
		]
		const { object } = await llm.generateObject({ messages, schema: InvoiceSchema })
		return object
	},
	{
		validators,
		maxRepairs: 3,
		onAttempt: (a) =>
			console.log(
				`  attempt ${a.attempt}: ${a.outcome.valid ? '✅' : '❌'} (${a.outcome.failures.length} failures)`,
			),
	},
)

console.log('\n📦 Outcome:', outcome.status)
if (outcome.status !== 'aborted') {
	console.log('  total:', outcome.value.total)
	console.log('  lineItems:', outcome.value.lineItems)
	console.log('  attempts:', outcome.attempts)
} else {
	console.log('  reason:', outcome.reason)
}
