import type { LLMJudge } from './eval'

export type TextGenerator = (prompt: string) => Promise<string>

export interface RubricCriterion {
	name: string
	description: string
	weight?: number
}

export interface RubricBreakdownItem {
	name: string
	score: number
	reasoning: string
	weight: number
}

export interface RubricJudgeResult {
	score: number
	reasoning: string
	breakdown: RubricBreakdownItem[]
}

export interface RubricJudgeConfig {
	generate: TextGenerator
	criteria: RubricCriterion[]
	scale?: number
}

export type RubricJudge = LLMJudge & {
	evaluate: (output: string) => Promise<RubricJudgeResult>
}

function buildRubricPrompt(output: string, criteria: RubricCriterion[], scale: number): string {
	const rubric = criteria.map((c, i) => `${i + 1}. ${c.name}: ${c.description}`).join('\n')

	return [
		`You are a strict evaluator. Score the output against each rubric criterion on a scale from 0 to ${scale}.`,
		'',
		'Rubric:',
		rubric,
		'',
		'Output to evaluate:',
		output,
		'',
		'Respond with ONLY a JSON object of this exact shape:',
		'{"scores":[{"name":"<criterion name>","score":<number>,"reasoning":"<brief justification>"}]}',
	].join('\n')
}

function extractJson(text: string): unknown {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
	const candidate = fenced ? fenced[1] : text
	const start = candidate.indexOf('{')
	const end = candidate.lastIndexOf('}')
	if (start === -1 || end === -1 || end < start) {
		throw new Error('No JSON object found in judge response')
	}
	return JSON.parse(candidate.slice(start, end + 1))
}

interface ParsedScore {
	name: string
	score: number
	reasoning: string
}

function parseScores(parsed: unknown): ParsedScore[] {
	if (typeof parsed !== 'object' || parsed === null) return []
	const scores = (parsed as { scores?: unknown }).scores
	if (!Array.isArray(scores)) return []
	return scores
		.filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
		.map((s) => ({
			name: typeof s.name === 'string' ? s.name : '',
			score: typeof s.score === 'number' ? s.score : Number(s.score) || 0,
			reasoning: typeof s.reasoning === 'string' ? s.reasoning : '',
		}))
}

export function createRubricJudge(config: RubricJudgeConfig): RubricJudge {
	const scale = config.scale ?? 10
	const criteria = config.criteria

	async function evaluate(output: string): Promise<RubricJudgeResult> {
		const prompt = buildRubricPrompt(output, criteria, scale)
		const raw = await config.generate(prompt)

		let parsedScores: ParsedScore[]
		try {
			parsedScores = parseScores(extractJson(raw))
		} catch (error) {
			return {
				score: 0,
				reasoning: `Failed to parse judge response: ${error instanceof Error ? error.message : String(error)}`,
				breakdown: [],
			}
		}

		const byName = new Map(parsedScores.map((s) => [s.name.toLowerCase(), s]))
		const breakdown: RubricBreakdownItem[] = criteria.map((c) => {
			const match = byName.get(c.name.toLowerCase())
			const normalized = match ? Math.max(0, Math.min(1, match.score / scale)) : 0
			return {
				name: c.name,
				score: normalized,
				reasoning: match?.reasoning ?? 'No score returned for this criterion',
				weight: c.weight ?? 1,
			}
		})

		const totalWeight = breakdown.reduce((sum, b) => sum + b.weight, 0)
		const score =
			totalWeight > 0 ? breakdown.reduce((sum, b) => sum + b.score * b.weight, 0) / totalWeight : 0

		const reasoning = breakdown.map((b) => `${b.name}: ${(b.score * 100).toFixed(0)}%`).join(', ')

		return { score, reasoning, breakdown }
	}

	const judge = (async (prompt: string) => {
		const result = await evaluate(prompt)
		return { score: result.score, reasoning: result.reasoning }
	}) as RubricJudge

	judge.evaluate = evaluate
	return judge
}
