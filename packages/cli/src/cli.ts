#!/usr/bin/env bun

import { costCommand } from './commands/cost'
import { devCommand } from './commands/dev'
import { evalCommand } from './commands/eval'
import { initCommand } from './commands/init'
import { promptCommand } from './commands/prompt'
import { traceCommand } from './commands/trace'
import { xrayCommand } from './commands/xray'

const VERSION = '0.1.0'

const HELP = `
  ElsiumAI CLI v${VERSION}

  Usage: elsium <command> [options]

  Commands:
    init [name]       Scaffold a new ElsiumAI project
    dev               Start development server with hot reload
    eval [file]       Run evaluation suite
    cost              Show cost report from last run
    trace [id]        Inspect trace from last run
    xray              Inspect LLM calls (X-Ray mode)
    prompt            Manage prompt versions

  Options:
    --help, -h        Show this help message
    --version, -v     Show version

  Examples:
    elsium init my-ai-app
    elsium dev
    elsium eval ./evals/suite.ts
    elsium cost
    elsium trace trc_abc123
    elsium xray --last 5
    elsium prompt list
`

async function main() {
	const args = process.argv.slice(2)
	const command = args[0]

	if (!command || command === '--help' || command === '-h') {
		console.log(HELP)
		process.exit(0)
	}

	if (command === '--version' || command === '-v') {
		console.log(VERSION)
		process.exit(0)
	}

	switch (command) {
		case 'init':
			await initCommand(args.slice(1))
			break
		case 'dev':
			await devCommand(args.slice(1))
			break
		case 'eval':
			await evalCommand(args.slice(1))
			break
		case 'cost':
			await costCommand(args.slice(1))
			break
		case 'trace':
			await traceCommand(args.slice(1))
			break
		case 'xray':
			await xrayCommand(args.slice(1))
			break
		case 'prompt':
			await promptCommand(args.slice(1))
			break
		default:
			console.error(`Unknown command: ${command}`)
			console.log(HELP)
			process.exit(1)
	}
}

main().catch((err) => {
	console.error('Error:', err.message)
	process.exit(1)
})
