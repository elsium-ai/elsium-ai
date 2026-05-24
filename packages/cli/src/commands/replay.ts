import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { type ExecutionProof, type ReplayStrategy, compareProofs } from '@elsium-ai/observe'

interface ReplayArgs {
	proofA: string
	proofB: string
	strategy: ReplayStrategy
	json: boolean
	help: boolean
}

const HELP = `
  elsium replay — Compare two ExecutionProofs

  Usage:
    elsium replay <proof-a.json> <proof-b.json> [options]

  Options:
    --strategy <bit-exact|structural>   Comparison tolerance (default: structural)
    --json                              Machine-readable JSON output
    -h, --help                          Show this help

  Strategies:
    bit-exact    Every event's hashSelf must match. Requires temperature: 0 + seed.
    structural   Same event order and types. tool.call / rag.retrieve / policy
                 data must match exactly; llm.call compared by model+provider only.

  Examples:
    elsium replay ./proofs/run-1.json ./proofs/run-2.json
    elsium replay ./run-a.json ./run-b.json --strategy bit-exact --json
`

function parseStrategy(value: string | undefined): ReplayStrategy {
	if (value !== 'bit-exact' && value !== 'structural') {
		throw new Error(`Invalid --strategy: ${value}. Use bit-exact or structural.`)
	}
	return value
}

function parseArgs(args: string[]): ReplayArgs {
	const parsed: ReplayArgs = {
		proofA: '',
		proofB: '',
		strategy: 'structural',
		json: false,
		help: false,
	}

	const positional: string[] = []

	for (let i = 0; i < args.length; i++) {
		const arg = args[i]
		if (arg === '--help' || arg === '-h') {
			parsed.help = true
		} else if (arg === '--json') {
			parsed.json = true
		} else if (arg === '--strategy') {
			parsed.strategy = parseStrategy(args[++i])
		} else if (!arg.startsWith('-')) {
			positional.push(arg)
		}
	}

	parsed.proofA = positional[0] ?? ''
	parsed.proofB = positional[1] ?? ''
	return parsed
}

function loadProof(path: string): ExecutionProof {
	const abs = resolve(process.cwd(), path)
	if (!existsSync(abs)) throw new Error(`Proof file not found: ${abs}`)
	return JSON.parse(readFileSync(abs, 'utf8')) as ExecutionProof
}

function formatDelta(delta: ReturnType<typeof compareProofs>['deltas'][number]): string {
	const evtType = delta.eventA?.type ?? delta.eventB?.type ?? '?'
	const detail = delta.detail ? ` — ${delta.detail}` : ''
	return `  [${delta.index}] ${delta.kind} (${evtType})${detail}`
}

function formatHuman(diff: ReturnType<typeof compareProofs>): string {
	const lines: string[] = []
	lines.push(`Strategy: ${diff.strategy}`)
	lines.push(`Match: ${diff.matches ? 'YES' : 'NO'}`)
	lines.push(
		`Events: A=${diff.eventCountA}, B=${diff.eventCountB} (matched=${diff.summary.matchedEvents}, differing=${diff.summary.differingEvents}, extraA=${diff.summary.extraInA}, extraB=${diff.summary.extraInB})`,
	)
	lines.push(`Agent ID match: ${diff.agentIdMatch ? 'yes' : 'no'}`)
	lines.push(`Agent version match: ${diff.agentVersionMatch ? 'yes' : 'no'}`)
	lines.push(`Chain head match: ${diff.chainHeadMatch ? 'yes' : 'no'}`)

	if (diff.deltas.length > 0) {
		lines.push('')
		lines.push('Deltas:')
		for (const delta of diff.deltas) lines.push(formatDelta(delta))
	}

	return lines.join('\n')
}

export async function replayCommand(args: string[]): Promise<void> {
	const parsed = parseArgs(args)

	if (parsed.help || !parsed.proofA || !parsed.proofB) {
		console.log(HELP)
		process.exit(parsed.help ? 0 : 1)
	}

	const proofA = loadProof(parsed.proofA)
	const proofB = loadProof(parsed.proofB)
	const diff = compareProofs(proofA, proofB, { strategy: parsed.strategy })

	if (parsed.json) {
		console.log(JSON.stringify(diff, null, 2))
	} else {
		console.log(formatHuman(diff))
	}

	process.exit(diff.matches ? 0 : 1)
}
