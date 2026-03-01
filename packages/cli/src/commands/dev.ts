import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

export async function devCommand(args: string[]) {
	const entryFile = args[0] ?? 'src/index.ts'
	const cwd = process.cwd()
	const fullPath = resolve(cwd, entryFile)

	if (!fullPath.startsWith(`${cwd}/`) && fullPath !== cwd) {
		console.error('Error: entry file must be within the project directory')
		process.exit(1)
	}

	if (!existsSync(fullPath)) {
		console.error(`Entry file not found: ${entryFile}`)
		console.error('Run this command from your ElsiumAI project root.')
		process.exit(1)
	}

	console.log('\n  ElsiumAI Dev Server')
	console.log(`  Watching: ${entryFile}`)
	console.log('  Press Ctrl+C to stop\n')

	const child = spawn('bun', ['--watch', entryFile], {
		stdio: 'inherit',
		cwd: process.cwd(),
	})

	child.on('error', (err) => {
		console.error('Failed to start dev server:', err.message)
		process.exit(1)
	})

	child.on('exit', (code) => {
		process.exit(code ?? 0)
	})

	process.on('SIGINT', () => {
		child.kill('SIGINT')
	})
}
