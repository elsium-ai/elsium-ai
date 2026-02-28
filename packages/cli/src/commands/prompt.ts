import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const PROMPTS_DIR = '.elsium/prompts'

interface PromptFile {
	name: string
	version: string
	content: string
	variables: string[]
	metadata?: Record<string, unknown>
}

function showHelp() {
	console.log(`
  ElsiumAI Prompt Manager

  Usage:
    elsium prompt list                   List all registered prompts
    elsium prompt diff <name> <v1> <v2>  Show diff between versions
    elsium prompt history <name>         Show version history
    elsium prompt show <name> [version]  Show prompt content

  Prompts are stored in .elsium/prompts/ as JSON files.
`)
}

function loadPromptFiles(promptsPath: string): PromptFile[] {
	if (!existsSync(promptsPath)) {
		return []
	}

	return readdirSync(promptsPath)
		.filter((f) => f.endsWith('.json'))
		.map((f) => {
			try {
				return JSON.parse(readFileSync(join(promptsPath, f), 'utf-8')) as PromptFile
			} catch {
				return null
			}
		})
		.filter((p): p is PromptFile => p !== null)
}

function handleList(promptsPath: string) {
	const allPrompts = loadPromptFiles(promptsPath)

	if (allPrompts.length === 0) {
		console.log('\n  No prompts found. Store prompts in .elsium/prompts/\n')
		return
	}

	const prompts = new Map<string, string[]>()
	for (const data of allPrompts) {
		if (!prompts.has(data.name)) prompts.set(data.name, [])
		const versions = prompts.get(data.name)
		if (versions) versions.push(data.version)
	}

	console.log(`\n  Registered Prompts (${prompts.size})`)
	console.log(`  ${'─'.repeat(50)}`)
	for (const [name, versions] of prompts) {
		console.log(`  ${name} — ${versions.length} version(s): ${versions.join(', ')}`)
	}
	console.log()
}

function handleHistory(promptsPath: string, name: string) {
	const files = loadPromptFiles(promptsPath)
		.filter((p) => p.name === name)
		.sort((a, b) => a.version.localeCompare(b.version))

	if (files.length === 0) {
		console.log(`\n  No versions found for prompt "${name}".\n`)
		return
	}

	console.log(`\n  Prompt History: ${name} (${files.length} versions)`)
	console.log(`  ${'─'.repeat(50)}`)
	for (const p of files) {
		console.log(
			`  v${p.version} — ${p.variables.length} variables: ${p.variables.join(', ') || 'none'}`,
		)
	}
	console.log()
}

function handleShow(promptsPath: string, name: string, version: string | undefined) {
	const files = loadPromptFiles(promptsPath).filter((p) => p.name === name)

	const prompt = version
		? files.find((p) => p.version === version)
		: files.sort((a, b) => b.version.localeCompare(a.version))[0]

	if (!prompt) {
		console.log(`\n  Prompt "${name}"${version ? ` v${version}` : ''} not found.\n`)
		return
	}

	console.log(`\n  Prompt: ${prompt.name} v${prompt.version}`)
	console.log(`  Variables: ${prompt.variables.join(', ') || 'none'}`)
	console.log(`  ${'─'.repeat(50)}`)
	console.log(prompt.content)
	console.log(`  ${'─'.repeat(50)}\n`)
}

function printDiffLines(fromLines: string[], toLines: string[]) {
	const maxLen = Math.max(fromLines.length, toLines.length)
	for (let i = 0; i < maxLen; i++) {
		const fl = fromLines[i]
		const tl = toLines[i]

		if (fl === undefined) {
			console.log(`  + ${tl}`)
		} else if (tl === undefined) {
			console.log(`  - ${fl}`)
		} else if (fl !== tl) {
			console.log(`  - ${fl}`)
			console.log(`  + ${tl}`)
		} else {
			console.log(`    ${fl}`)
		}
	}
}

function handleDiff(promptsPath: string, name: string, v1: string, v2: string) {
	const files = loadPromptFiles(promptsPath).filter((p) => p.name === name)

	const from = files.find((p) => p.version === v1)
	const to = files.find((p) => p.version === v2)

	if (!from || !to) {
		console.error(`  Could not find both versions: ${v1} and ${v2}`)
		process.exit(1)
	}

	console.log(`\n  Diff: ${name} v${v1} → v${v2}`)
	console.log(`  ${'─'.repeat(50)}`)
	printDiffLines(from.content.split('\n'), to.content.split('\n'))
	console.log(`  ${'─'.repeat(50)}\n`)
}

export async function promptCommand(args: string[]) {
	const subcommand = args[0]

	if (!subcommand || subcommand === '--help' || subcommand === '-h') {
		showHelp()
		return
	}

	const promptsPath = join(process.cwd(), PROMPTS_DIR)

	switch (subcommand) {
		case 'list':
			handleList(promptsPath)
			break
		case 'history': {
			const name = args[1]
			if (!name) {
				console.error('  Please provide a prompt name: elsium prompt history <name>')
				process.exit(1)
			}
			handleHistory(promptsPath, name)
			break
		}
		case 'show': {
			const name = args[1]
			if (!name) {
				console.error('  Please provide a prompt name: elsium prompt show <name> [version]')
				process.exit(1)
			}
			handleShow(promptsPath, name, args[2])
			break
		}
		case 'diff': {
			const name = args[1]
			const v1 = args[2]
			const v2 = args[3]
			if (!name || !v1 || !v2) {
				console.error('  Usage: elsium prompt diff <name> <v1> <v2>')
				process.exit(1)
			}
			handleDiff(promptsPath, name, v1, v2)
			break
		}
		default:
			console.error(`  Unknown subcommand: ${subcommand}`)
			console.log('  Run "elsium prompt --help" for usage information.')
			process.exit(1)
	}
}
