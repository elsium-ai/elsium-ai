import { existsSync } from 'node:fs'
import { join } from 'node:path'

export async function evalCommand(args: string[]) {
	const evalFile = args[0]

	if (!evalFile) {
		console.log(`
  Usage: elsium eval <file>

  Run an evaluation suite against your prompts.

  Examples:
    elsium eval ./evals/suite.ts
    elsium eval ./evals/quality.ts

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
`)
		return
	}

	const fullPath = join(process.cwd(), evalFile)

	if (!existsSync(fullPath)) {
		console.error(`Eval file not found: ${evalFile}`)
		process.exit(1)
	}

	try {
		const mod = await import(fullPath)
		const config = mod.default ?? mod

		if (!config.name || !config.cases || !config.runner) {
			console.error('Eval file must export a valid EvalSuiteConfig with name, cases, and runner.')
			process.exit(1)
		}

		// Dynamic import of testing package
		const { runEvalSuite, formatEvalReport } = await import('@elsium-ai/testing' as string)

		console.log(`\n  Running eval suite: ${config.name}`)
		console.log(`  Cases: ${config.cases.length}\n`)

		const result = await runEvalSuite(config)
		console.log(formatEvalReport(result))

		if (result.failed > 0) {
			process.exit(1)
		}
	} catch (err) {
		console.error('Failed to run eval:', err instanceof Error ? err.message : err)
		process.exit(1)
	}
}
