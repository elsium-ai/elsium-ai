import type { LLMJudge } from './eval'

export interface RagMetricResult {
	score: number
	reasoning: string
}

export interface FaithfulnessInput {
	answer: string
	contexts: string[]
	judge: LLMJudge
}

export interface AnswerRelevancyInput {
	question: string
	answer: string
	judge: LLMJudge
}

export interface ContextRelevanceInput {
	contexts: string[]
	relevant: string[]
}

function clampScore(score: number): number {
	if (Number.isNaN(score)) return 0
	if (score < 0) return 0
	if (score > 1) return 1
	return score
}

function joinContexts(contexts: string[]): string {
	return contexts.map((c, i) => `[${i + 1}] ${c}`).join('\n')
}

export async function faithfulness(input: FaithfulnessInput): Promise<RagMetricResult> {
	const prompt = [
		'You are evaluating FAITHFULNESS: whether every claim in the answer is supported by the retrieved context.',
		'Score 1.0 if all claims are grounded in the context, 0.0 if the answer is fabricated or contradicts the context.',
		'',
		'Retrieved context:',
		joinContexts(input.contexts),
		'',
		'Answer:',
		input.answer,
	].join('\n')

	const result = await input.judge(prompt)
	return { score: clampScore(result.score), reasoning: result.reasoning }
}

export async function answerRelevancy(input: AnswerRelevancyInput): Promise<RagMetricResult> {
	const prompt = [
		'You are evaluating ANSWER RELEVANCY: whether the answer directly addresses the question.',
		'Score 1.0 if the answer is fully on-topic and complete, 0.0 if it is evasive or unrelated.',
		'',
		'Question:',
		input.question,
		'',
		'Answer:',
		input.answer,
	].join('\n')

	const result = await input.judge(prompt)
	return { score: clampScore(result.score), reasoning: result.reasoning }
}

export function contextPrecision(input: ContextRelevanceInput): RagMetricResult {
	const relevant = new Set(input.relevant)
	let hits = 0
	let cumulative = 0
	for (let i = 0; i < input.contexts.length; i++) {
		if (relevant.has(input.contexts[i])) {
			hits++
			cumulative += hits / (i + 1)
		}
	}
	const score = hits > 0 ? cumulative / hits : 0
	return {
		score: clampScore(score),
		reasoning: `${hits}/${input.contexts.length} retrieved contexts are relevant (rank-weighted)`,
	}
}

export function contextRecall(input: ContextRelevanceInput): RagMetricResult {
	if (input.relevant.length === 0) {
		return { score: 1, reasoning: 'No relevant contexts expected' }
	}
	const retrieved = new Set(input.contexts)
	const found = input.relevant.filter((r) => retrieved.has(r)).length
	const score = found / input.relevant.length
	return {
		score: clampScore(score),
		reasoning: `${found}/${input.relevant.length} relevant contexts were retrieved`,
	}
}

export interface RagEvalCase {
	name?: string
	question: string
	answer: string
	contexts: string[]
	relevant?: string[]
}

export interface RagEvalConfig {
	name: string
	cases: RagEvalCase[]
	judge?: LLMJudge
	concurrency?: number
}

export interface RagCaseResult {
	name?: string
	question: string
	faithfulness?: RagMetricResult
	answerRelevancy?: RagMetricResult
	contextPrecision?: RagMetricResult
	contextRecall?: RagMetricResult
	score: number
}

export interface RagEvalAggregate {
	faithfulness?: number
	answerRelevancy?: number
	contextPrecision?: number
	contextRecall?: number
	overall: number
}

export interface RagEvalResult {
	name: string
	cases: RagCaseResult[]
	aggregate: RagEvalAggregate
	durationMs: number
}

async function evaluateRagCase(evalCase: RagEvalCase, judge?: LLMJudge): Promise<RagCaseResult> {
	const metrics: RagMetricResult[] = []
	const result: RagCaseResult = {
		name: evalCase.name,
		question: evalCase.question,
		score: 0,
	}

	if (judge) {
		result.faithfulness = await faithfulness({
			answer: evalCase.answer,
			contexts: evalCase.contexts,
			judge,
		})
		result.answerRelevancy = await answerRelevancy({
			question: evalCase.question,
			answer: evalCase.answer,
			judge,
		})
		metrics.push(result.faithfulness, result.answerRelevancy)
	}

	if (evalCase.relevant) {
		result.contextPrecision = contextPrecision({
			contexts: evalCase.contexts,
			relevant: evalCase.relevant,
		})
		result.contextRecall = contextRecall({
			contexts: evalCase.contexts,
			relevant: evalCase.relevant,
		})
		metrics.push(result.contextPrecision, result.contextRecall)
	}

	result.score =
		metrics.length > 0 ? metrics.reduce((sum, m) => sum + m.score, 0) / metrics.length : 0

	return result
}

function mean(values: number[]): number {
	return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0
}

function aggregateRag(cases: RagCaseResult[]): RagEvalAggregate {
	const defined = (values: (number | undefined)[]): number[] =>
		values.filter((v): v is number => v !== undefined)
	const faith = defined(cases.map((c) => c.faithfulness?.score))
	const relevancy = defined(cases.map((c) => c.answerRelevancy?.score))
	const precision = defined(cases.map((c) => c.contextPrecision?.score))
	const recall = defined(cases.map((c) => c.contextRecall?.score))

	const aggregate: RagEvalAggregate = {
		overall: mean(cases.map((c) => c.score)),
	}
	if (faith.length > 0) aggregate.faithfulness = mean(faith)
	if (relevancy.length > 0) aggregate.answerRelevancy = mean(relevancy)
	if (precision.length > 0) aggregate.contextPrecision = mean(precision)
	if (recall.length > 0) aggregate.contextRecall = mean(recall)
	return aggregate
}

export async function runRagEval(config: RagEvalConfig): Promise<RagEvalResult> {
	const startTime = performance.now()
	const concurrency = config.concurrency ?? 1
	const results: RagCaseResult[] = []

	if (concurrency <= 1) {
		for (const evalCase of config.cases) {
			results.push(await evaluateRagCase(evalCase, config.judge))
		}
	} else {
		for (let i = 0; i < config.cases.length; i += concurrency) {
			const batch = config.cases.slice(i, i + concurrency)
			const batchResults = await Promise.all(batch.map((c) => evaluateRagCase(c, config.judge)))
			results.push(...batchResults)
		}
	}

	return {
		name: config.name,
		cases: results,
		aggregate: aggregateRag(results),
		durationMs: Math.round(performance.now() - startTime),
	}
}

function formatMetric(label: string, metric?: RagMetricResult): string | null {
	if (!metric) return null
	return `    ${label}: ${(metric.score * 100).toFixed(1)}% — ${metric.reasoning}`
}

export function formatRagEvalReport(result: RagEvalResult): string {
	const lines: string[] = []
	lines.push('')
	lines.push(`  RAG Eval: ${result.name}`)
	lines.push(`  ${'─'.repeat(50)}`)

	for (const c of result.cases) {
		lines.push(`  [${(c.score * 100).toFixed(0)}%] ${c.name ?? c.question}`)
		for (const line of [
			formatMetric('faithfulness', c.faithfulness),
			formatMetric('answer relevancy', c.answerRelevancy),
			formatMetric('context precision', c.contextPrecision),
			formatMetric('context recall', c.contextRecall),
		]) {
			if (line) lines.push(line)
		}
	}

	lines.push(`  ${'─'.repeat(50)}`)
	const agg = result.aggregate
	const parts: string[] = [`overall ${(agg.overall * 100).toFixed(1)}%`]
	if (agg.faithfulness !== undefined) parts.push(`faith ${(agg.faithfulness * 100).toFixed(1)}%`)
	if (agg.answerRelevancy !== undefined)
		parts.push(`relevancy ${(agg.answerRelevancy * 100).toFixed(1)}%`)
	if (agg.contextPrecision !== undefined)
		parts.push(`ctx-prec ${(agg.contextPrecision * 100).toFixed(1)}%`)
	if (agg.contextRecall !== undefined)
		parts.push(`ctx-recall ${(agg.contextRecall * 100).toFixed(1)}%`)
	lines.push(`  ${parts.join(' | ')} | ${result.durationMs}ms`)
	lines.push('')
	return lines.join('\n')
}
