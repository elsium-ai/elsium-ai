export interface DeterminismResult {
	deterministic: boolean
	runs: number
	uniqueOutputs: number
	outputs: string[]
	variance: number
}

export interface StabilityResult {
	stable: boolean
	runs: number
	uniqueOutputs: number
	outputs: Array<{ output: string; timestamp: number }>
	variance: number
}

export async function assertDeterministic(
	fn: (seed?: number) => Promise<string>,
	options?: { runs?: number; seed?: number; tolerance?: number },
): Promise<DeterminismResult> {
	const runs = options?.runs ?? 5
	const seed = options?.seed
	const tolerance = options?.tolerance ?? 0

	const outputs: string[] = []

	for (let i = 0; i < runs; i++) {
		const output = await fn(seed)
		outputs.push(output)
	}

	const unique = new Set(outputs)
	const uniqueOutputs = unique.size
	const variance = runs > 1 ? (uniqueOutputs - 1) / (runs - 1) : 0
	const deterministic = variance <= tolerance

	if (!deterministic && tolerance === 0) {
		throw new Error(
			`Non-deterministic output: ${uniqueOutputs} unique outputs across ${runs} runs (variance: ${variance.toFixed(3)})`,
		)
	}

	return {
		deterministic,
		runs,
		uniqueOutputs,
		outputs,
		variance,
	}
}

export async function assertStable(
	fn: (seed?: number) => Promise<string>,
	options?: { intervalMs?: number; runs?: number; seed?: number },
): Promise<StabilityResult> {
	const intervalMs = options?.intervalMs ?? 100
	const runs = options?.runs ?? 3
	const seed = options?.seed

	const outputs: Array<{ output: string; timestamp: number }> = []

	for (let i = 0; i < runs; i++) {
		if (i > 0) {
			await new Promise((r) => setTimeout(r, intervalMs))
		}
		const output = await fn(seed)
		outputs.push({ output, timestamp: Date.now() })
	}

	const unique = new Set(outputs.map((o) => o.output))
	const uniqueOutputs = unique.size
	const variance = runs > 1 ? (uniqueOutputs - 1) / (runs - 1) : 0

	return {
		stable: uniqueOutputs === 1,
		runs,
		uniqueOutputs,
		outputs,
		variance,
	}
}
