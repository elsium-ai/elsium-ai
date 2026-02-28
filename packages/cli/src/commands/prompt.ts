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

export async function promptCommand(args: string[]) {
	const subcommand = args[0]

	if (!subcommand || subcommand === '--help' || subcommand === '-h') {
		console.log(`
  ElsiumAI Prompt Manager

  Usage:
    elsium prompt list                   List all registered prompts
    elsium prompt diff <name> <v1> <v2>  Show diff between versions
    elsium prompt history <name>         Show version history
    elsium prompt show <name> [version]  Show prompt content

  Prompts are stored in .elsium/prompts/ as JSON files.
`)
		return
	}

	const promptsPath = join(process.cwd(), PROMPTS_DIR)

	switch (subcommand) {
		case 'list': {
			if (!existsSync(promptsPath)) {
				console.log('\n  No prompts found. Store prompts in .elsium/prompts/\n')
				return
			}

			const files = readdirSync(promptsPath).filter((f) => f.endsWith('.json'))
			if (files.length === 0) {
				console.log('\n  No prompts found.\n')
				return
			}

			const prompts = new Map<string, string[]>()
			for (const file of files) {
				try {
					const data = JSON.parse(readFileSync(join(promptsPath, file), 'utf-8')) as PromptFile
					if (!prompts.has(data.name)) prompts.set(data.name, [])
					const versions = prompts.get(data.name)
					if (versions) versions.push(data.version)
				} catch {
					// skip invalid files
				}
			}

			console.log(`\n  Registered Prompts (${prompts.size})`)
			console.log(`  ${'─'.repeat(50)}`)
			for (const [name, versions] of prompts) {
				console.log(`  ${name} — ${versions.length} version(s): ${versions.join(', ')}`)
			}
			console.log()
			break
		}

		case 'history': {
			const name = args[1]
			if (!name) {
				console.error('  Please provide a prompt name: elsium prompt history <name>')
				process.exit(1)
			}

			if (!existsSync(promptsPath)) {
				console.log(`\n  No prompts found for "${name}".\n`)
				return
			}

			const files = readdirSync(promptsPath)
				.filter((f) => f.endsWith('.json'))
				.map((f) => {
					try {
						return JSON.parse(readFileSync(join(promptsPath, f), 'utf-8')) as PromptFile
					} catch {
						return null
					}
				})
				.filter((p): p is PromptFile => p !== null && p.name === name)
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
			break
		}

		case 'show': {
			const name = args[1]
			const version = args[2]
			if (!name) {
				console.error('  Please provide a prompt name: elsium prompt show <name> [version]')
				process.exit(1)
			}

			if (!existsSync(promptsPath)) {
				console.log(`\n  Prompt "${name}" not found.\n`)
				return
			}

			const files = readdirSync(promptsPath)
				.filter((f) => f.endsWith('.json'))
				.map((f) => {
					try {
						return JSON.parse(readFileSync(join(promptsPath, f), 'utf-8')) as PromptFile
					} catch {
						return null
					}
				})
				.filter((p): p is PromptFile => p !== null && p.name === name)

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

			if (!existsSync(promptsPath)) {
				console.log('\n  No prompts found.\n')
				return
			}

			const files = readdirSync(promptsPath)
				.filter((f) => f.endsWith('.json'))
				.map((f) => {
					try {
						return JSON.parse(readFileSync(join(promptsPath, f), 'utf-8')) as PromptFile
					} catch {
						return null
					}
				})
				.filter((p): p is PromptFile => p !== null && p.name === name)

			const from = files.find((p) => p.version === v1)
			const to = files.find((p) => p.version === v2)

			if (!from || !to) {
				console.error(`  Could not find both versions: ${v1} and ${v2}`)
				process.exit(1)
			}

			const fromLines = from.content.split('\n')
			const toLines = to.content.split('\n')

			console.log(`\n  Diff: ${name} v${v1} → v${v2}`)
			console.log(`  ${'─'.repeat(50)}`)

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
			console.log(`  ${'─'.repeat(50)}\n`)
			break
		}

		default:
			console.error(`  Unknown subcommand: ${subcommand}`)
			console.log('  Run "elsium prompt --help" for usage information.')
			process.exit(1)
	}
}
