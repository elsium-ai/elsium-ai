import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const COST_FILE = '.elsium/cost-report.json'

interface CostReportData {
	totalCost: number
	totalTokens: number
	totalInputTokens: number
	totalOutputTokens: number
	callCount: number
	byModel: Record<string, { cost: number; tokens: number; calls: number }>
	timestamp: string
}

export async function costCommand(args: string[]) {
	const costPath = join(process.cwd(), COST_FILE)

	if (!existsSync(costPath)) {
		console.log(`
  No cost report found.

  Cost reports are generated automatically when you run your app
  with observability enabled:

    const app = createApp({
      observe: {
        costTracking: true,
      },
    })

  The report will be saved to .elsium/cost-report.json
`)
		return
	}

	try {
		const data: CostReportData = JSON.parse(readFileSync(costPath, 'utf-8'))

		console.log('\n  ElsiumAI Cost Report')
		console.log(`  ${'─'.repeat(50)}`)
		console.log(`  Generated: ${data.timestamp}`)
		console.log()
		console.log(`  Total Cost:          $${data.totalCost.toFixed(6)}`)
		console.log(`  Total Tokens:        ${data.totalTokens.toLocaleString()}`)
		console.log(`    Input Tokens:      ${data.totalInputTokens.toLocaleString()}`)
		console.log(`    Output Tokens:     ${data.totalOutputTokens.toLocaleString()}`)
		console.log(`  Total API Calls:     ${data.callCount}`)
		console.log()

		if (Object.keys(data.byModel).length > 0) {
			console.log('  By Model:')
			console.log(`  ${'─'.repeat(50)}`)

			for (const [model, stats] of Object.entries(data.byModel)) {
				console.log(`    ${model}`)
				console.log(`      Cost:    $${stats.cost.toFixed(6)}`)
				console.log(`      Tokens:  ${stats.tokens.toLocaleString()}`)
				console.log(`      Calls:   ${stats.calls}`)
			}
		}

		console.log()
	} catch (err) {
		console.error('Failed to read cost report:', err instanceof Error ? err.message : err)
		process.exit(1)
	}
}
