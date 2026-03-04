import { describe, expect, it } from 'vitest'
import { calculateCost, estimateCost, registerPricing } from './pricing'

// ─── calculateCost ────────────────────────────────────────────────

describe('calculateCost', () => {
	it('returns correct cost for a known Anthropic model', () => {
		// claude-opus-4-6: $15 input / $75 output per million tokens
		const cost = calculateCost('claude-opus-4-6', {
			inputTokens: 1_000_000,
			outputTokens: 1_000_000,
			totalTokens: 2_000_000,
		})

		expect(cost.inputCost).toBeCloseTo(15, 4)
		expect(cost.outputCost).toBeCloseTo(75, 4)
		expect(cost.totalCost).toBeCloseTo(90, 4)
		expect(cost.currency).toBe('USD')
	})

	it('returns correct cost for a known OpenAI model', () => {
		// gpt-4o: $2.5 input / $10 output per million tokens
		const cost = calculateCost('gpt-4o', {
			inputTokens: 500_000,
			outputTokens: 250_000,
			totalTokens: 750_000,
		})

		expect(cost.inputCost).toBeCloseTo(1.25, 4)
		expect(cost.outputCost).toBeCloseTo(2.5, 4)
		expect(cost.totalCost).toBeCloseTo(3.75, 4)
		expect(cost.currency).toBe('USD')
	})

	it('returns correct cost for a known Google model', () => {
		// gemini-2.0-flash: $0.10 input / $0.40 output per million tokens
		const cost = calculateCost('gemini-2.0-flash', {
			inputTokens: 1_000_000,
			outputTokens: 1_000_000,
			totalTokens: 2_000_000,
		})

		expect(cost.inputCost).toBeCloseTo(0.1, 4)
		expect(cost.outputCost).toBeCloseTo(0.4, 4)
		expect(cost.totalCost).toBeCloseTo(0.5, 4)
	})

	it('returns $0 cost for an unknown model', () => {
		const cost = calculateCost('totally-unknown-model-xyz', {
			inputTokens: 1_000_000,
			outputTokens: 500_000,
			totalTokens: 1_500_000,
		})

		expect(cost.inputCost).toBe(0)
		expect(cost.outputCost).toBe(0)
		expect(cost.totalCost).toBe(0)
		expect(cost.currency).toBe('USD')
	})

	it('returns $0 cost for zero token usage', () => {
		const cost = calculateCost('claude-sonnet-4-6', {
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
		})

		expect(cost.inputCost).toBe(0)
		expect(cost.outputCost).toBe(0)
		expect(cost.totalCost).toBe(0)
	})

	it('rounds cost values to 6 decimal places', () => {
		// claude-sonnet-4-6: $3 input / $15 output per million
		// 1 token input => 3 / 1_000_000 = 0.000003
		const cost = calculateCost('claude-sonnet-4-6', {
			inputTokens: 1,
			outputTokens: 1,
			totalTokens: 2,
		})

		// Values should be finite numbers, not Infinity or NaN
		expect(Number.isFinite(cost.inputCost)).toBe(true)
		expect(Number.isFinite(cost.outputCost)).toBe(true)
		expect(Number.isFinite(cost.totalCost)).toBe(true)

		// Precision limited to 6 decimal places
		const decimals = (cost.totalCost.toString().split('.')[1] ?? '').length
		expect(decimals).toBeLessThanOrEqual(6)
	})

	it('resolves date-suffixed model name to base model for cost calculation', () => {
		// claude-opus-4-6-2025-01-01 should resolve to claude-opus-4-6
		const withSuffix = calculateCost('claude-opus-4-6-2025-01-01', {
			inputTokens: 1_000_000,
			outputTokens: 0,
			totalTokens: 1_000_000,
		})
		const withoutSuffix = calculateCost('claude-opus-4-6', {
			inputTokens: 1_000_000,
			outputTokens: 0,
			totalTokens: 1_000_000,
		})

		expect(withSuffix.inputCost).toBe(withoutSuffix.inputCost)
		expect(withSuffix.outputCost).toBe(withoutSuffix.outputCost)
		expect(withSuffix.totalCost).toBe(withoutSuffix.totalCost)
	})
})

// ─── registerPricing ─────────────────────────────────────────────

describe('registerPricing', () => {
	it('registers a new model and makes calculateCost use it', () => {
		registerPricing('my-test-model-v1', {
			inputPerMillion: 10,
			outputPerMillion: 20,
		})

		const cost = calculateCost('my-test-model-v1', {
			inputTokens: 1_000_000,
			outputTokens: 500_000,
			totalTokens: 1_500_000,
		})

		expect(cost.inputCost).toBeCloseTo(10, 4)
		expect(cost.outputCost).toBeCloseTo(10, 4)
		expect(cost.totalCost).toBeCloseTo(20, 4)
		expect(cost.currency).toBe('USD')
	})

	it('overrides existing pricing for a model', () => {
		registerPricing('pricing-override-model', {
			inputPerMillion: 50,
			outputPerMillion: 100,
		})

		// Now override
		registerPricing('pricing-override-model', {
			inputPerMillion: 1,
			outputPerMillion: 2,
		})

		const cost = calculateCost('pricing-override-model', {
			inputTokens: 1_000_000,
			outputTokens: 1_000_000,
			totalTokens: 2_000_000,
		})

		expect(cost.inputCost).toBeCloseTo(1, 4)
		expect(cost.outputCost).toBeCloseTo(2, 4)
	})

	it('makes the registered model no longer return $0', () => {
		// Before registration the model is unknown
		const before = calculateCost('brand-new-model-xyz-999', {
			inputTokens: 1_000,
			outputTokens: 1_000,
			totalTokens: 2_000,
		})
		expect(before.totalCost).toBe(0)

		registerPricing('brand-new-model-xyz-999', {
			inputPerMillion: 5,
			outputPerMillion: 5,
		})

		const after = calculateCost('brand-new-model-xyz-999', {
			inputTokens: 1_000,
			outputTokens: 1_000,
			totalTokens: 2_000,
		})
		expect(after.totalCost).toBeGreaterThan(0)
	})
})

// ─── estimateCost ─────────────────────────────────────────────────

describe('estimateCost', () => {
	it('returns the input cost estimate for a known model', () => {
		// claude-sonnet-4-6: $3 per million input tokens
		const estimate = estimateCost('claude-sonnet-4-6', 1_000_000)
		expect(estimate).toBeCloseTo(3, 4)
	})

	it('returns 0 for an unknown model', () => {
		const estimate = estimateCost('completely-unknown-model-abc', 1_000_000)
		expect(estimate).toBe(0)
	})

	it('scales linearly with token count', () => {
		const half = estimateCost('gpt-4o', 500_000)
		const full = estimateCost('gpt-4o', 1_000_000)
		expect(full).toBeCloseTo(half * 2, 6)
	})

	it('returns 0 for zero tokens', () => {
		const estimate = estimateCost('claude-opus-4-6', 0)
		expect(estimate).toBe(0)
	})

	it('resolves date-suffixed model name', () => {
		// gpt-4o-2025-06-15 should resolve to gpt-4o
		const withSuffix = estimateCost('gpt-4o-2025-06-15', 1_000_000)
		const withoutSuffix = estimateCost('gpt-4o', 1_000_000)
		expect(withSuffix).toBe(withoutSuffix)
	})

	it('uses registered custom pricing for estimateCost', () => {
		registerPricing('estimate-custom-model', {
			inputPerMillion: 8,
			outputPerMillion: 16,
		})

		const estimate = estimateCost('estimate-custom-model', 1_000_000)
		expect(estimate).toBeCloseTo(8, 4)
	})
})

// ─── resolveModelName (via calculateCost behavior) ────────────────

describe('resolveModelName (date-suffix stripping)', () => {
	it('strips YYYY-MM-DD suffix from claude models', () => {
		// claude-sonnet-4-6: $3/$15 per million
		const stripped = calculateCost('claude-sonnet-4-6-2025-03-01', {
			inputTokens: 1_000_000,
			outputTokens: 0,
			totalTokens: 1_000_000,
		})
		expect(stripped.inputCost).toBeCloseTo(3, 4)
	})

	it('strips YYYY-MM-DD suffix from OpenAI models', () => {
		// gpt-4o: $2.5 per million input
		const stripped = calculateCost('gpt-4o-2025-12-31', {
			inputTokens: 1_000_000,
			outputTokens: 0,
			totalTokens: 1_000_000,
		})
		expect(stripped.inputCost).toBeCloseTo(2.5, 4)
	})

	it('returns $0 when date-stripped base is still unknown', () => {
		const cost = calculateCost('fictional-model-2025-01-01', {
			inputTokens: 1_000_000,
			outputTokens: 0,
			totalTokens: 1_000_000,
		})
		expect(cost.totalCost).toBe(0)
	})

	it('does not strip non-date suffixes', () => {
		// 'gpt-4o-mini' should NOT be stripped to 'gpt-4o'
		const mini = calculateCost('gpt-4o-mini', {
			inputTokens: 1_000_000,
			outputTokens: 0,
			totalTokens: 1_000_000,
		})
		const base = calculateCost('gpt-4o', {
			inputTokens: 1_000_000,
			outputTokens: 0,
			totalTokens: 1_000_000,
		})
		// gpt-4o-mini ($0.15/M) != gpt-4o ($2.5/M)
		expect(mini.inputCost).not.toBeCloseTo(base.inputCost, 2)
	})

	it('uses the model as-is if it directly matches a known pricing key (no suffix stripping needed)', () => {
		// claude-haiku-4-5-20251001 is a directly registered key (not date-stripped)
		const direct = calculateCost('claude-haiku-4-5-20251001', {
			inputTokens: 1_000_000,
			outputTokens: 0,
			totalTokens: 1_000_000,
		})
		// inputPerMillion = 1
		expect(direct.inputCost).toBeCloseTo(1, 4)
	})
})
