export interface EvalCase {
	name: string
	input: string
	expected?: string
	criteria?: EvalCriterion[]
	tags?: string[]
}

export type LLMJudge = (prompt: string) => Promise<{ score: number; reasoning: string }>

export type EvalCriterion =
	| { type: 'contains'; value: string; caseSensitive?: boolean }
	| { type: 'not_contains'; value: string; caseSensitive?: boolean }
	| { type: 'matches'; pattern: string; flags?: string }
	| { type: 'length_min'; value: number }
	| { type: 'length_max'; value: number }
	| { type: 'json_valid' }
	| { type: 'json_matches'; schema: Record<string, unknown> }
	| { type: 'custom'; name: string; fn: (output: string) => boolean }
	| { type: 'llm_judge'; prompt: string; judge: LLMJudge; threshold?: number }
	| { type: 'semantic_similarity'; reference: string; threshold?: number }
	| { type: 'factual_accuracy'; facts: string[]; threshold?: number }

export interface EvalResult {
	name: string
	passed: boolean
	score: number
	criteria: CriterionResult[]
	input: string
	output: string
	durationMs: number
	tags: string[]
}

export interface CriterionResult {
	type: string
	passed: boolean
	message: string
}

export interface EvalSuiteConfig {
	name: string
	cases: EvalCase[]
	runner: (input: string) => Promise<string>
	concurrency?: number
}

export interface EvalSuiteResult {
	name: string
	total: number
	passed: number
	failed: number
	score: number
	results: EvalResult[]
	durationMs: number
}

// ─── Criterion Evaluation ────────────────────────────────────────

function evaluateContains(
	output: string,
	criterion: Extract<EvalCriterion, { type: 'contains' }>,
): CriterionResult {
	const target = criterion.caseSensitive ? criterion.value : criterion.value.toLowerCase()
	const haystack = criterion.caseSensitive ? output : output.toLowerCase()
	const passed = haystack.includes(target)
	return {
		type: 'contains',
		passed,
		message: passed ? `Contains "${criterion.value}"` : `Does not contain "${criterion.value}"`,
	}
}

function evaluateNotContains(
	output: string,
	criterion: Extract<EvalCriterion, { type: 'not_contains' }>,
): CriterionResult {
	const target = criterion.caseSensitive ? criterion.value : criterion.value.toLowerCase()
	const haystack = criterion.caseSensitive ? output : output.toLowerCase()
	const passed = !haystack.includes(target)
	return {
		type: 'not_contains',
		passed,
		message: passed
			? `Does not contain "${criterion.value}"`
			: `Contains "${criterion.value}" (should not)`,
	}
}

function evaluateMatches(
	output: string,
	criterion: Extract<EvalCriterion, { type: 'matches' }>,
): CriterionResult {
	const regex = new RegExp(criterion.pattern, criterion.flags)
	const passed = regex.test(output)
	return {
		type: 'matches',
		passed,
		message: passed ? `Matches /${criterion.pattern}/` : `Does not match /${criterion.pattern}/`,
	}
}

function evaluateLengthMin(
	output: string,
	criterion: Extract<EvalCriterion, { type: 'length_min' }>,
): CriterionResult {
	const passed = output.length >= criterion.value
	return {
		type: 'length_min',
		passed,
		message: passed
			? `Length ${output.length} >= ${criterion.value}`
			: `Length ${output.length} < ${criterion.value}`,
	}
}

function evaluateLengthMax(
	output: string,
	criterion: Extract<EvalCriterion, { type: 'length_max' }>,
): CriterionResult {
	const passed = output.length <= criterion.value
	return {
		type: 'length_max',
		passed,
		message: passed
			? `Length ${output.length} <= ${criterion.value}`
			: `Length ${output.length} > ${criterion.value}`,
	}
}

function evaluateJsonValid(output: string): CriterionResult {
	try {
		JSON.parse(output)
		return { type: 'json_valid', passed: true, message: 'Valid JSON' }
	} catch {
		return { type: 'json_valid', passed: false, message: 'Invalid JSON' }
	}
}

function evaluateJsonMatches(
	output: string,
	criterion: Extract<EvalCriterion, { type: 'json_matches' }>,
): CriterionResult {
	try {
		const parsed = JSON.parse(output)
		const passed = matchesSchema(parsed, criterion.schema)
		return {
			type: 'json_matches',
			passed,
			message: passed ? 'JSON matches schema' : 'JSON does not match schema',
		}
	} catch {
		return { type: 'json_matches', passed: false, message: 'Invalid JSON' }
	}
}

function evaluateCustom(
	output: string,
	criterion: Extract<EvalCriterion, { type: 'custom' }>,
): CriterionResult {
	const passed = criterion.fn(output)
	return {
		type: `custom:${criterion.name}`,
		passed,
		message: passed
			? `Custom check "${criterion.name}" passed`
			: `Custom check "${criterion.name}" failed`,
	}
}

function evaluateSemanticSimilarity(
	output: string,
	criterion: Extract<EvalCriterion, { type: 'semantic_similarity' }>,
): CriterionResult {
	const refWords = new Set(
		criterion.reference
			.toLowerCase()
			.split(/\s+/)
			.filter((w) => w.length > 3),
	)
	const outWords = output
		.toLowerCase()
		.split(/\s+/)
		.filter((w) => w.length > 3)
	const overlap = outWords.filter((w) => refWords.has(w)).length
	const score = refWords.size > 0 ? overlap / refWords.size : 0
	const threshold = criterion.threshold ?? 0.7
	const passed = score >= threshold
	return {
		type: 'semantic_similarity',
		passed,
		message: passed
			? `Semantic similarity ${(score * 100).toFixed(0)}% >= ${(threshold * 100).toFixed(0)}%`
			: `Semantic similarity ${(score * 100).toFixed(0)}% < ${(threshold * 100).toFixed(0)}%`,
	}
}

function evaluateFactualAccuracy(
	output: string,
	criterion: Extract<EvalCriterion, { type: 'factual_accuracy' }>,
): CriterionResult {
	const facts = criterion.facts
	let matchedFacts = 0
	const outputLower = output.toLowerCase()
	for (const fact of facts) {
		const factWords = fact
			.toLowerCase()
			.split(/\s+/)
			.filter((w) => w.length > 3)
		const matches = factWords.filter((w) => outputLower.includes(w)).length
		if (matches / Math.max(factWords.length, 1) > 0.5) {
			matchedFacts++
		}
	}
	const score = facts.length > 0 ? matchedFacts / facts.length : 1
	const threshold = criterion.threshold ?? 0.7
	const passed = score >= threshold
	return {
		type: 'factual_accuracy',
		passed,
		message: passed
			? `Factual accuracy: ${matchedFacts}/${facts.length} facts verified`
			: `Factual accuracy: only ${matchedFacts}/${facts.length} facts found`,
	}
}

function evaluateCriterion(output: string, criterion: EvalCriterion): CriterionResult {
	switch (criterion.type) {
		case 'contains':
			return evaluateContains(output, criterion)
		case 'not_contains':
			return evaluateNotContains(output, criterion)
		case 'matches':
			return evaluateMatches(output, criterion)
		case 'length_min':
			return evaluateLengthMin(output, criterion)
		case 'length_max':
			return evaluateLengthMax(output, criterion)
		case 'json_valid':
			return evaluateJsonValid(output)
		case 'json_matches':
			return evaluateJsonMatches(output, criterion)
		case 'custom':
			return evaluateCustom(output, criterion)
		case 'llm_judge':
			return { type: 'llm_judge', passed: false, message: 'LLM judge requires async evaluation' }
		case 'semantic_similarity':
			return evaluateSemanticSimilarity(output, criterion)
		case 'factual_accuracy':
			return evaluateFactualAccuracy(output, criterion)
	}
}

function matchesSchema(value: unknown, schema: Record<string, unknown>): boolean {
	if (typeof value !== 'object' || value === null) return false
	const obj = value as Record<string, unknown>

	for (const key of Object.keys(schema)) {
		if (!(key in obj)) return false

		const expectedType = schema[key]
		if (typeof expectedType === 'string') {
			const actualType = typeof obj[key]
			if (actualType !== expectedType) return false
		}
	}

	return true
}

// ─── Eval Runner ─────────────────────────────────────────────────

function makeRunnerErrorResult(evalCase: EvalCase, error: unknown, startTime: number): EvalResult {
	return {
		name: evalCase.name,
		passed: false,
		score: 0,
		criteria: [
			{
				type: 'error',
				passed: false,
				message: `Runner error: ${error instanceof Error ? error.message : String(error)}`,
			},
		],
		input: evalCase.input,
		output: '',
		durationMs: Math.round(performance.now() - startTime),
		tags: evalCase.tags ?? [],
	}
}

function checkExpected(output: string, expected: string): CriterionResult {
	const passed = output.includes(expected)
	return {
		type: 'expected',
		passed,
		message: passed
			? 'Output contains expected text'
			: `Output does not contain expected "${expected}"`,
	}
}

async function evaluateLlmJudge(
	output: string,
	criterion: Extract<EvalCriterion, { type: 'llm_judge' }>,
): Promise<CriterionResult> {
	try {
		const fullPrompt = `${criterion.prompt}\n\nOutput to evaluate:\n${output}`
		const result = await criterion.judge(fullPrompt)
		const threshold = criterion.threshold ?? 0.7
		const passed = result.score >= threshold
		return {
			type: 'llm_judge',
			passed,
			message: passed
				? `LLM judge score: ${result.score.toFixed(2)} (${result.reasoning})`
				: `LLM judge score: ${result.score.toFixed(2)} < ${threshold} (${result.reasoning})`,
		}
	} catch (error) {
		return {
			type: 'llm_judge',
			passed: false,
			message: `LLM judge error: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}

async function evaluateAllCriteria(output: string, evalCase: EvalCase): Promise<CriterionResult[]> {
	const criteriaResults: CriterionResult[] = []

	if (evalCase.expected !== undefined) {
		criteriaResults.push(checkExpected(output, evalCase.expected))
	}

	for (const criterion of evalCase.criteria ?? []) {
		if (criterion.type === 'llm_judge') {
			criteriaResults.push(await evaluateLlmJudge(output, criterion))
		} else {
			criteriaResults.push(evaluateCriterion(output, criterion))
		}
	}

	return criteriaResults
}

async function runCase(
	evalCase: EvalCase,
	runner: (input: string) => Promise<string>,
): Promise<EvalResult> {
	const startTime = performance.now()

	let output: string
	try {
		output = await runner(evalCase.input)
	} catch (error) {
		return makeRunnerErrorResult(evalCase, error, startTime)
	}

	const criteriaResults = await evaluateAllCriteria(output, evalCase)

	const passedCount = criteriaResults.filter((c) => c.passed).length
	const totalCount = criteriaResults.length
	const allPassed = totalCount === 0 || passedCount === totalCount
	const score = totalCount === 0 ? 1 : passedCount / totalCount

	return {
		name: evalCase.name,
		passed: allPassed,
		score,
		criteria: criteriaResults,
		input: evalCase.input,
		output,
		durationMs: Math.round(performance.now() - startTime),
		tags: evalCase.tags ?? [],
	}
}

export async function runEvalSuite(config: EvalSuiteConfig): Promise<EvalSuiteResult> {
	const startTime = performance.now()
	const concurrency = config.concurrency ?? 1

	const results: EvalResult[] = []

	if (concurrency <= 1) {
		for (const evalCase of config.cases) {
			results.push(await runCase(evalCase, config.runner))
		}
	} else {
		// Run in batches
		for (let i = 0; i < config.cases.length; i += concurrency) {
			const batch = config.cases.slice(i, i + concurrency)
			const batchResults = await Promise.all(batch.map((c) => runCase(c, config.runner)))
			results.push(...batchResults)
		}
	}

	const passed = results.filter((r) => r.passed).length
	const failed = results.length - passed

	return {
		name: config.name,
		total: results.length,
		passed,
		failed,
		score: results.length > 0 ? passed / results.length : 0,
		results,
		durationMs: Math.round(performance.now() - startTime),
	}
}

// ─── Formatting ──────────────────────────────────────────────────

export function formatEvalReport(result: EvalSuiteResult): string {
	const lines: string[] = []

	lines.push(`\n  Eval Suite: ${result.name}`)
	lines.push(`  ${'─'.repeat(50)}`)

	for (const r of result.results) {
		const icon = r.passed ? 'PASS' : 'FAIL'
		lines.push(`  [${icon}] ${r.name} (${r.durationMs}ms)`)

		if (!r.passed) {
			for (const c of r.criteria) {
				if (!c.passed) {
					lines.push(`         ${c.message}`)
				}
			}
		}
	}

	lines.push(`  ${'─'.repeat(50)}`)
	lines.push(
		`  Score: ${(result.score * 100).toFixed(1)}% | ${result.passed}/${result.total} passed | ${result.durationMs}ms`,
	)
	lines.push('')

	return lines.join('\n')
}
