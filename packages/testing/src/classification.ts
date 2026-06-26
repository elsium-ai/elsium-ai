export interface ClassificationCase {
	name?: string
	predicted: string
	actual: string
}

export interface LabelMetrics {
	label: string
	precision: number
	recall: number
	f1: number
	support: number
}

export interface AverageMetrics {
	precision: number
	recall: number
	f1: number
}

export interface ConfusionMatrix {
	labels: string[]
	matrix: number[][]
}

export interface ClassificationReport {
	total: number
	correct: number
	accuracy: number
	labels: string[]
	perLabel: LabelMetrics[]
	macro: AverageMetrics
	micro: AverageMetrics
	weighted: AverageMetrics
	confusion: ConfusionMatrix
}

export interface ClassificationOptions {
	labels?: string[]
}

function resolveLabels(cases: ClassificationCase[], provided?: string[]): string[] {
	if (provided && provided.length > 0) return [...provided]
	const seen = new Set<string>()
	for (const c of cases) {
		seen.add(c.actual)
		seen.add(c.predicted)
	}
	return [...seen].sort()
}

function divide(numerator: number, denominator: number): number {
	return denominator === 0 ? 0 : numerator / denominator
}

function f1Score(precision: number, recall: number): number {
	return divide(2 * precision * recall, precision + recall)
}

export function computeConfusionMatrix(
	cases: ClassificationCase[],
	options: ClassificationOptions = {},
): ConfusionMatrix {
	const labels = resolveLabels(cases, options.labels)
	const index = new Map(labels.map((label, i) => [label, i]))
	const matrix = labels.map(() => labels.map(() => 0))

	for (const c of cases) {
		const actualIndex = index.get(c.actual)
		const predictedIndex = index.get(c.predicted)
		if (actualIndex === undefined || predictedIndex === undefined) continue
		matrix[actualIndex][predictedIndex]++
	}

	return { labels, matrix }
}

export function computeClassificationReport(
	cases: ClassificationCase[],
	options: ClassificationOptions = {},
): ClassificationReport {
	const confusion = computeConfusionMatrix(cases, options)
	const { labels, matrix } = confusion
	const size = labels.length

	const rowSums = labels.map((_, i) => matrix[i].reduce((sum, v) => sum + v, 0))
	const colSums = labels.map((_, j) => matrix.reduce((sum, row) => sum + row[j], 0))
	const diagonal = labels.map((_, i) => matrix[i][i])

	const total = rowSums.reduce((sum, v) => sum + v, 0)
	const correct = diagonal.reduce((sum, v) => sum + v, 0)

	const perLabel: LabelMetrics[] = labels.map((label, i) => {
		const precision = divide(diagonal[i], colSums[i])
		const recall = divide(diagonal[i], rowSums[i])
		return {
			label,
			precision,
			recall,
			f1: f1Score(precision, recall),
			support: rowSums[i],
		}
	})

	const macro: AverageMetrics = {
		precision: divide(
			perLabel.reduce((sum, m) => sum + m.precision, 0),
			size,
		),
		recall: divide(
			perLabel.reduce((sum, m) => sum + m.recall, 0),
			size,
		),
		f1: divide(
			perLabel.reduce((sum, m) => sum + m.f1, 0),
			size,
		),
	}

	const weighted: AverageMetrics = {
		precision: divide(
			perLabel.reduce((sum, m) => sum + m.precision * m.support, 0),
			total,
		),
		recall: divide(
			perLabel.reduce((sum, m) => sum + m.recall * m.support, 0),
			total,
		),
		f1: divide(
			perLabel.reduce((sum, m) => sum + m.f1 * m.support, 0),
			total,
		),
	}

	const microPrecision = divide(correct, total)
	const micro: AverageMetrics = {
		precision: microPrecision,
		recall: microPrecision,
		f1: microPrecision,
	}

	return {
		total,
		correct,
		accuracy: divide(correct, total),
		labels,
		perLabel,
		macro,
		micro,
		weighted,
		confusion,
	}
}

export interface ClassificationEvalCase {
	name?: string
	input: string
	expected: string
}

export interface ClassificationEvalConfig {
	name: string
	cases: ClassificationEvalCase[]
	runner: (input: string) => Promise<string>
	labels?: string[]
	concurrency?: number
}

export interface ClassificationPrediction {
	name?: string
	input: string
	expected: string
	predicted: string
	correct: boolean
	error?: string
}

export interface ClassificationEvalResult {
	name: string
	report: ClassificationReport
	predictions: ClassificationPrediction[]
	durationMs: number
}

async function predictCase(
	evalCase: ClassificationEvalCase,
	runner: (input: string) => Promise<string>,
): Promise<ClassificationPrediction> {
	try {
		const predicted = (await runner(evalCase.input)).trim()
		return {
			name: evalCase.name,
			input: evalCase.input,
			expected: evalCase.expected,
			predicted,
			correct: predicted === evalCase.expected,
		}
	} catch (error) {
		return {
			name: evalCase.name,
			input: evalCase.input,
			expected: evalCase.expected,
			predicted: '',
			correct: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

export async function runClassificationEval(
	config: ClassificationEvalConfig,
): Promise<ClassificationEvalResult> {
	const startTime = performance.now()
	const concurrency = config.concurrency ?? 1
	const predictions: ClassificationPrediction[] = []

	if (concurrency <= 1) {
		for (const evalCase of config.cases) {
			predictions.push(await predictCase(evalCase, config.runner))
		}
	} else {
		for (let i = 0; i < config.cases.length; i += concurrency) {
			const batch = config.cases.slice(i, i + concurrency)
			const batchResults = await Promise.all(batch.map((c) => predictCase(c, config.runner)))
			predictions.push(...batchResults)
		}
	}

	const report = computeClassificationReport(
		predictions.map((p) => ({ name: p.name, predicted: p.predicted, actual: p.expected })),
		{ labels: config.labels },
	)

	return {
		name: config.name,
		report,
		predictions,
		durationMs: Math.round(performance.now() - startTime),
	}
}

function pad(value: string, width: number): string {
	return value.length >= width ? value : value + ' '.repeat(width - value.length)
}

function padStart(value: string, width: number): string {
	return value.length >= width ? value : ' '.repeat(width - value.length) + value
}

export function formatConfusionMatrix(confusion: ConfusionMatrix): string {
	const { labels, matrix } = confusion
	const labelWidth = Math.max(...labels.map((l) => l.length), 8)
	const cellWidth = Math.max(...labels.map((l) => l.length), 4)

	const lines: string[] = []
	lines.push('  Confusion Matrix (rows = actual, cols = predicted)')
	const header = `${pad('', labelWidth)}  ${labels.map((l) => padStart(l, cellWidth)).join('  ')}`
	lines.push(`  ${header}`)
	for (let i = 0; i < labels.length; i++) {
		const row = matrix[i].map((v) => padStart(String(v), cellWidth)).join('  ')
		lines.push(`  ${pad(labels[i], labelWidth)}  ${row}`)
	}
	return lines.join('\n')
}

function formatPercent(value: number): string {
	return `${(value * 100).toFixed(1)}%`
}

export function formatClassificationReport(report: ClassificationReport): string {
	const lines: string[] = []
	const labelWidth = Math.max(...report.labels.map((l) => l.length), 8)

	lines.push('')
	lines.push(`  Classification Report (${report.total} cases)`)
	lines.push(`  ${'─'.repeat(56)}`)
	lines.push(
		`  ${pad('label', labelWidth)}  ${padStart('prec', 8)}  ${padStart('recall', 8)}  ${padStart('f1', 8)}  ${padStart('support', 8)}`,
	)
	for (const m of report.perLabel) {
		lines.push(
			`  ${pad(m.label, labelWidth)}  ${padStart(formatPercent(m.precision), 8)}  ${padStart(formatPercent(m.recall), 8)}  ${padStart(formatPercent(m.f1), 8)}  ${padStart(String(m.support), 8)}`,
		)
	}
	lines.push(`  ${'─'.repeat(56)}`)
	lines.push(
		`  ${pad('macro', labelWidth)}  ${padStart(formatPercent(report.macro.precision), 8)}  ${padStart(formatPercent(report.macro.recall), 8)}  ${padStart(formatPercent(report.macro.f1), 8)}`,
	)
	lines.push(
		`  ${pad('weighted', labelWidth)}  ${padStart(formatPercent(report.weighted.precision), 8)}  ${padStart(formatPercent(report.weighted.recall), 8)}  ${padStart(formatPercent(report.weighted.f1), 8)}`,
	)
	lines.push(`  ${pad('accuracy', labelWidth)}  ${padStart(formatPercent(report.accuracy), 8)}`)
	lines.push('')
	lines.push(formatConfusionMatrix(report.confusion))
	lines.push('')
	return lines.join('\n')
}
