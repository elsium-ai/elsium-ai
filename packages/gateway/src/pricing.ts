import type { CostBreakdown, TokenUsage } from '@elsium-ai/core'

interface ModelPricing {
	inputPerMillion: number
	outputPerMillion: number
}

const PRICING: Record<string, ModelPricing> = {
	// Anthropic
	'claude-opus-4-6': { inputPerMillion: 15, outputPerMillion: 75 },
	'claude-sonnet-4-6': { inputPerMillion: 3, outputPerMillion: 15 },
	'claude-haiku-4-5-20251001': { inputPerMillion: 1, outputPerMillion: 5 },
	// OpenAI — GPT
	'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10 },
	'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
	'gpt-4.1': { inputPerMillion: 2, outputPerMillion: 8 },
	'gpt-4.1-mini': { inputPerMillion: 0.4, outputPerMillion: 1.6 },
	'gpt-4.1-nano': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
	'gpt-5': { inputPerMillion: 1.25, outputPerMillion: 10 },
	'gpt-5-mini': { inputPerMillion: 0.25, outputPerMillion: 2 },
	'gpt-5-nano': { inputPerMillion: 0.05, outputPerMillion: 0.4 },
	// OpenAI — Reasoning
	o1: { inputPerMillion: 15, outputPerMillion: 60 },
	'o1-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4 },
	o3: { inputPerMillion: 2, outputPerMillion: 8 },
	'o3-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4 },
	'o3-pro': { inputPerMillion: 20, outputPerMillion: 80 },
	'o4-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4 },
	// Google
	'gemini-2.0-flash': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
	'gemini-2.0-flash-lite': { inputPerMillion: 0.075, outputPerMillion: 0.3 },
	'gemini-2.5-pro-preview-05-06': { inputPerMillion: 1.25, outputPerMillion: 10 },
	'gemini-2.5-flash-preview-04-17': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
}

export function calculateCost(model: string, usage: TokenUsage): CostBreakdown {
	const pricing = PRICING[model]

	if (!pricing) {
		return {
			inputCost: 0,
			outputCost: 0,
			totalCost: 0,
			currency: 'USD',
		}
	}

	const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPerMillion
	const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPerMillion

	return {
		inputCost: Math.round(inputCost * 1_000_000) / 1_000_000,
		outputCost: Math.round(outputCost * 1_000_000) / 1_000_000,
		totalCost: Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000,
		currency: 'USD',
	}
}

export function registerPricing(model: string, pricing: ModelPricing): void {
	PRICING[model] = pricing
}
