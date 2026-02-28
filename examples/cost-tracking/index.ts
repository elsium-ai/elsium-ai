/**
 * Cost Intelligence Engine Example
 *
 * Demonstrates:
 * - Per-user and per-agent budget tracking
 * - Loop detection
 * - Cost projections and recommendations
 * - Model suggestions for cost optimization
 */

import { createCostEngine, gateway } from 'elsium-ai'

async function main() {
	console.log('\n── Cost Intelligence Engine Demo ──\n')

	// Create a cost engine with budgets and alerts
	const costEngine = createCostEngine({
		dailyBudget: 50,
		perUser: 5,
		perAgent: 10,
		totalBudget: 100,
		alertThresholds: [0.5, 0.8, 0.95],
		loopDetection: {
			maxCallsPerMinute: 20,
			maxCostPerMinute: 2,
		},
		onAlert: (alert) => {
			console.log(`[ALERT] ${alert.type}: ${alert.message}`)
		},
	})

	// Create a gateway with cost tracking middleware
	const gw = gateway({
		provider: 'anthropic',
		apiKey: process.env.ANTHROPIC_API_KEY ?? 'demo-key',
		xray: true,
		middleware: [costEngine.middleware()],
	})

	// Simulate some API calls
	console.log('Simulating API calls...\n')

	// Simulate tracked calls without actual API
	const models = ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'gpt-4o', 'claude-opus-4-6']
	const agents = ['research-bot', 'support-bot', 'coding-bot']
	const users = ['user-1', 'user-2', 'user-3']

	for (let i = 0; i < 20; i++) {
		const model = models[i % models.length]
		const agent = agents[i % agents.length]
		const user = users[i % users.length]

		costEngine.trackCall(
			{
				id: `msg_${i}`,
				message: { role: 'assistant', content: `Response ${i}` },
				usage: {
					inputTokens: 100 + Math.floor(Math.random() * 500),
					outputTokens: 50 + Math.floor(Math.random() * 200),
					totalTokens: 0, // will be recalculated
				},
				cost: {
					inputCost: 0.001 * (i + 1),
					outputCost: 0.002 * (i + 1),
					totalCost: 0.003 * (i + 1),
					currency: 'USD',
				},
				model,
				provider: model.startsWith('gpt') ? 'openai' : 'anthropic',
				stopReason: 'end_turn',
				latencyMs: 100 + Math.floor(Math.random() * 500),
				traceId: `trc_${i}`,
			},
			{ agent, user },
		)
	}

	// Get the intelligence report
	const report = costEngine.getReport()

	console.log('── Cost Report ──')
	console.log(`Total Spend:            $${report.totalSpend.toFixed(4)}`)
	console.log(`Total Tokens:           ${report.totalTokens.toLocaleString()}`)
	console.log(`Total Calls:            ${report.totalCalls}`)
	console.log(`Projected Daily:        $${report.projectedDailySpend.toFixed(2)}`)
	console.log(`Projected Monthly:      $${report.projectedMonthlySpend.toFixed(2)}`)

	console.log('\n── By Model ──')
	for (const [model, dim] of Object.entries(report.byModel)) {
		console.log(`  ${model}: $${dim.totalCost.toFixed(4)} (${dim.callCount} calls)`)
	}

	console.log('\n── By Agent ──')
	for (const [agent, dim] of Object.entries(report.byAgent)) {
		console.log(`  ${agent}: $${dim.totalCost.toFixed(4)} (${dim.callCount} calls)`)
	}

	console.log('\n── By User ──')
	for (const [user, dim] of Object.entries(report.byUser)) {
		console.log(`  ${user}: $${dim.totalCost.toFixed(4)} (${dim.callCount} calls)`)
	}

	// Model suggestions
	console.log('\n── Model Suggestions ──')
	const suggestion = costEngine.suggestModel('claude-opus-4-6', 200)
	if (suggestion) {
		console.log(`  ${suggestion.reason}`)
		console.log(
			`  Switch ${suggestion.currentModel} → ${suggestion.suggestedModel} (${suggestion.estimatedSavings.toFixed(0)}% savings)`,
		)
	}

	// Recommendations
	if (report.recommendations.length > 0) {
		console.log('\n── Recommendations ──')
		for (const rec of report.recommendations) {
			console.log(`  - ${rec}`)
		}
	}

	// Alerts
	if (report.alerts.length > 0) {
		console.log('\n── Alerts ──')
		for (const alert of report.alerts) {
			console.log(`  [${alert.type}] ${alert.message}`)
		}
	}

	console.log()
}

main().catch(console.error)
