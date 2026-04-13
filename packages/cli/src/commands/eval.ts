import { existsSync } from 'node:fs'
import { join } from 'node:path'

type OutputFormat = 'text' | 'junit' | 'github' | 'markdown'

interface EvalFlags {
	file?: string
	dataset?: string
	compare?: string
	saveBaseline: boolean
	baselineDir: string
	format: OutputFormat
}

const VALID_FORMATS = new Set<string>(['text', 'junit', 'github', 'markdown'])

function parseFlags(args: string[]): EvalFlags {
	const flags: EvalFlags = {
		saveBaseline: false,
		baselineDir: join(process.cwd(), '.elsium/baselines'),
		format: 'text',
	}

	for (let i = 0; i < args.length; i++) {
		const arg = args[i]
		const next = args[i + 1]
		switch (arg) {
			case '--dataset':
				if (next) {
					flags.dataset = next
					i++
				}
				break
			case '--compare':
				if (next) {
					flags.compare = next
					i++
				}
				break
			case '--save-baseline':
				flags.saveBaseline = true
				break
			case '--baseline-dir':
				if (next) {
					flags.baselineDir = next
					i++
				}
				break
			case '--format':
				if (next && VALID_FORMATS.has(next)) {
					flags.format = next as OutputFormat
					i++
				}
				break
			default:
				if (!arg.startsWith('--')) flags.file = arg
		}
	}

	return flags
}

const USAGE = `
  Usage: elsium eval <file> [options]

  Run an evaluation suite against your prompts.

  Options:
    --dataset <path>        Load cases from external dataset file
    --compare <name>        Compare against saved baseline
    --save-baseline         Save current results as baseline
    --baseline-dir <dir>    Directory for baselines (default: .elsium/baselines)
    --format <fmt>          Output format: text, junit, github, markdown (default: text)

  Examples:
    elsium eval ./evals/suite.ts
    elsium eval ./evals/quality.ts --dataset ./data/cases.json
    elsium eval ./evals/suite.ts --save-baseline
    elsium eval ./evals/suite.ts --compare my-eval

  Eval file should export a default EvalSuiteConfig:

    import { type EvalSuiteConfig } from '@elsium-ai/testing'

    export default {
      name: 'my-eval',
      cases: [
        {
          name: 'test-1',
          input: 'What is TypeScript?',
          criteria: [
            { type: 'contains', value: 'typed' },
            { type: 'length_min', value: 20 },
          ],
        },
      ],
      runner: async (input) => {
        // Call your agent/LLM here
        return response
      },
    } satisfies EvalSuiteConfig
`

async function loadDatasetIfNeeded(
	// biome-ignore lint/suspicious/noExplicitAny: dynamic import
	testing: any,
	// biome-ignore lint/suspicious/noExplicitAny: dynamic import
	config: any,
	flags: EvalFlags,
): Promise<void> {
	if (!flags.dataset) return
	const datasetPath = join(process.cwd(), flags.dataset)
	if (!existsSync(datasetPath)) {
		console.error(`Dataset file not found: ${flags.dataset}`)
		process.exit(1)
	}
	const dataset = await testing.loadDataset(datasetPath)
	if (dataset.cases.length > 0) {
		config.cases = dataset.cases
	}
}

async function handleBaseline(
	// biome-ignore lint/suspicious/noExplicitAny: dynamic import
	testing: any,
	// biome-ignore lint/suspicious/noExplicitAny: dynamic import
	result: any,
	flags: EvalFlags,
): Promise<void> {
	if (flags.saveBaseline) {
		const filePath = await testing.saveBaseline(result, flags.baselineDir)
		console.log(`  Baseline saved: ${filePath}\n`)
	}

	if (!flags.compare) return
	const baseline = await testing.loadBaseline(flags.compare, flags.baselineDir)
	if (!baseline) {
		console.error(`Baseline not found: ${flags.compare}`)
		console.error(`  Looked in: ${flags.baselineDir}`)
		return
	}
	const comparison = testing.compareResults(baseline, result)
	console.log(testing.formatComparison(comparison))
	if (comparison.regression) {
		process.exit(1)
	}
}

export async function evalCommand(args: string[]) {
	const flags = parseFlags(args)

	if (!flags.file) {
		console.log(USAGE)
		return
	}

	const fullPath = join(process.cwd(), flags.file)

	if (!existsSync(fullPath)) {
		console.error(`Eval file not found: ${flags.file}`)
		process.exit(1)
	}

	try {
		const mod = await import(fullPath)
		const config = mod.default ?? mod

		if (!config.name || !config.cases || !config.runner) {
			console.error('Eval file must export a valid EvalSuiteConfig with name, cases, and runner.')
			process.exit(1)
		}

		const testing = await import('@elsium-ai/testing' as string)

		await loadDatasetIfNeeded(testing, config, flags)

		console.log(`\n  Running eval suite: ${config.name}`)
		console.log(`  Cases: ${config.cases.length}\n`)

		const result = await testing.runEvalSuite(config)

		switch (flags.format) {
			case 'junit':
				console.log(testing.toJUnitXML(result))
				break
			case 'github':
				console.log(testing.toGitHubAnnotations(result))
				break
			case 'markdown':
				console.log(testing.toMarkdownSummary(result))
				break
			default:
				console.log(testing.formatEvalReport(result))
		}

		await handleBaseline(testing, result, flags)

		if (result.failed > 0) {
			process.exit(1)
		}
	} catch (err) {
		console.error('Failed to run eval:', err instanceof Error ? err.message : err)
		process.exit(1)
	}
}
