#!/usr/bin/env bun

import { createRequire } from 'node:module'
import { costCommand } from './commands/cost'
import { devCommand } from './commands/dev'
import { evalCommand } from './commands/eval'
import { initCommand } from './commands/init'
import { promptCommand } from './commands/prompt'
import { proxyCommand } from './commands/proxy'
import { replayCommand } from './commands/replay'
import { studioCommand } from './commands/studio'
import { traceCommand } from './commands/trace'
import { verifyCommand } from './commands/verify'
import { xrayCommand } from './commands/xray'

const _require = createRequire(import.meta.url)
const pkg = _require('../package.json') as { version: string }
const VERSION = pkg.version

const HELP = `
  ElsiumAI CLI v${VERSION}

  Usage: elsium <command> [options]

  Commands:
    init [name]       Scaffold a new ElsiumAI project
    dev               Start development server with hot reload
    studio            Open local dev dashboard (traces, costs, X-Ray)
    eval [file]       Run evaluation suite
    cost              Show cost report from last run
    trace [id]        Inspect trace from last run
    xray              Inspect LLM calls (X-Ray mode)
    prompt            Manage prompt versions
    proxy             Start AI proxy server
    verify <proof>    Verify a signed ExecutionProof offline
    replay <a> <b>    Compare two ExecutionProofs

  Options:
    --help, -h        Show this help message
    --version, -v     Show version

  Examples:
    elsium init my-ai-app
    elsium dev
    elsium studio
    elsium eval ./evals/suite.ts
    elsium cost
    elsium trace trc_abc123
    elsium xray --last 5
    elsium prompt list
    elsium proxy --port 4000 --audit --cache
    elsium verify ./proofs/proof_abc.json --public-key ./org-aperion.pub
    elsium replay ./proofs/run-1.json ./proofs/run-2.json --strategy structural
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
		case 'studio':
			await studioCommand(args.slice(1))
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
		case 'proxy':
			await proxyCommand(args.slice(1), VERSION)
			break
		case 'verify':
			await verifyCommand(args.slice(1))
			break
		case 'replay':
			await replayCommand(args.slice(1))
			break
		default:
			console.error(`Unknown command: ${command}`)
			console.log(HELP)
			process.exit(1)
	}
}

main().catch((err: unknown) => {
	const message = err instanceof Error ? err.message : String(err)
	console.error('Error:', message)
	process.exit(1)
})
