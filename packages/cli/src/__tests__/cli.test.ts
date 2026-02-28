import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Helper to capture console output
function captureConsole() {
	const logs: string[] = []
	const errors: string[] = []
	const origLog = console.log
	const origError = console.error
	console.log = (...args: unknown[]) => logs.push(args.join(' '))
	console.error = (...args: unknown[]) => errors.push(args.join(' '))
	return {
		logs,
		errors,
		restore() {
			console.log = origLog
			console.error = origError
		},
	}
}

describe('CLI - init command', () => {
	let testDir: string

	beforeEach(() => {
		testDir = join(tmpdir(), `elsium-cli-test-${Date.now()}`)
		mkdirSync(testDir, { recursive: true })
	})

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true })
	})

	it('should scaffold a new project', async () => {
		const origCwd = process.cwd()
		process.chdir(testDir)

		const { initCommand } = await import('../commands/init')
		const output = captureConsole()
		try {
			await initCommand(['test-app'])
		} finally {
			output.restore()
			process.chdir(origCwd)
		}

		const projectDir = join(testDir, 'test-app')
		expect(existsSync(projectDir)).toBe(true)
		expect(existsSync(join(projectDir, 'package.json'))).toBe(true)
		expect(existsSync(join(projectDir, 'tsconfig.json'))).toBe(true)
		expect(existsSync(join(projectDir, '.env.example'))).toBe(true)
		expect(existsSync(join(projectDir, '.gitignore'))).toBe(true)
		expect(existsSync(join(projectDir, 'src/index.ts'))).toBe(true)

		const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8'))
		expect(pkg.name).toBe('test-app')
		expect(pkg.dependencies['@elsium-ai/core']).toBeDefined()
	})

	it('should use default name if none provided', async () => {
		const origCwd = process.cwd()
		process.chdir(testDir)

		const { initCommand } = await import('../commands/init')
		const output = captureConsole()
		try {
			await initCommand([])
		} finally {
			output.restore()
			process.chdir(origCwd)
		}

		expect(existsSync(join(testDir, 'my-elsium-app'))).toBe(true)
	})

	it('should fail if directory exists', async () => {
		const origCwd = process.cwd()
		process.chdir(testDir)
		mkdirSync(join(testDir, 'existing-app'))

		const { initCommand } = await import('../commands/init')
		const output = captureConsole()
		const origExit = process.exit
		let exitCode: number | undefined
		process.exit = ((code: number) => {
			exitCode = code
		}) as never

		try {
			await initCommand(['existing-app'])
		} finally {
			output.restore()
			process.exit = origExit
			process.chdir(origCwd)
		}

		expect(exitCode).toBe(1)
		expect(output.errors.some((e) => e.includes('already exists'))).toBe(true)
	})

	it('should generate valid package.json with correct dependencies', async () => {
		const origCwd = process.cwd()
		process.chdir(testDir)

		const { initCommand } = await import('../commands/init')
		const output = captureConsole()
		try {
			await initCommand(['dep-check'])
		} finally {
			output.restore()
			process.chdir(origCwd)
		}

		const pkg = JSON.parse(readFileSync(join(testDir, 'dep-check/package.json'), 'utf-8'))
		expect(pkg.dependencies['@elsium-ai/core']).toBe('^0.1.0')
		expect(pkg.dependencies['@elsium-ai/gateway']).toBe('^0.1.0')
		expect(pkg.dependencies['@elsium-ai/agents']).toBe('^0.1.0')
		expect(pkg.dependencies['@elsium-ai/tools']).toBe('^0.1.0')
		expect(pkg.dependencies['@elsium-ai/app']).toBe('^0.1.0')
		expect(pkg.devDependencies['@elsium-ai/testing']).toBe('^0.1.0')
	})

	it('should generate src/index.ts with correct imports', async () => {
		const origCwd = process.cwd()
		process.chdir(testDir)

		const { initCommand } = await import('../commands/init')
		const output = captureConsole()
		try {
			await initCommand(['import-check'])
		} finally {
			output.restore()
			process.chdir(origCwd)
		}

		const src = readFileSync(join(testDir, 'import-check/src/index.ts'), 'utf-8')
		expect(src).toContain("from '@elsium-ai/app'")
		expect(src).toContain("from '@elsium-ai/agents'")
		expect(src).toContain("from '@elsium-ai/gateway'")
		expect(src).toContain('createApp')
		expect(src).toContain('defineAgent')
	})
})

describe('CLI - cost command', () => {
	let testDir: string

	beforeEach(() => {
		testDir = join(tmpdir(), `elsium-cost-test-${Date.now()}`)
		mkdirSync(testDir, { recursive: true })
	})

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true })
	})

	it('should show message when no cost report exists', async () => {
		const origCwd = process.cwd()
		process.chdir(testDir)

		const { costCommand } = await import('../commands/cost')
		const output = captureConsole()
		try {
			await costCommand([])
		} finally {
			output.restore()
			process.chdir(origCwd)
		}

		expect(output.logs.some((l) => l.includes('No cost report found'))).toBe(true)
	})

	it('should display cost report', async () => {
		const origCwd = process.cwd()
		process.chdir(testDir)

		mkdirSync(join(testDir, '.elsium'), { recursive: true })
		writeFileSync(
			join(testDir, '.elsium/cost-report.json'),
			JSON.stringify({
				totalCost: 0.0532,
				totalTokens: 15000,
				totalInputTokens: 12000,
				totalOutputTokens: 3000,
				callCount: 5,
				byModel: {
					'claude-sonnet-4-6': { cost: 0.0532, tokens: 15000, calls: 5 },
				},
				timestamp: '2026-02-28T12:00:00Z',
			}),
		)

		const { costCommand } = await import('../commands/cost')
		const output = captureConsole()
		try {
			await costCommand([])
		} finally {
			output.restore()
			process.chdir(origCwd)
		}

		expect(output.logs.some((l) => l.includes('Cost Report'))).toBe(true)
		expect(output.logs.some((l) => l.includes('$0.053200'))).toBe(true)
		expect(output.logs.some((l) => l.includes('15,000'))).toBe(true)
		expect(output.logs.some((l) => l.includes('claude-sonnet-4-6'))).toBe(true)
	})
})

describe('CLI - trace command', () => {
	let testDir: string

	beforeEach(() => {
		testDir = join(tmpdir(), `elsium-trace-test-${Date.now()}`)
		mkdirSync(testDir, { recursive: true })
	})

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true })
	})

	it('should show message when no traces directory exists', async () => {
		const origCwd = process.cwd()
		process.chdir(testDir)

		const { traceCommand } = await import('../commands/trace')
		const output = captureConsole()
		try {
			await traceCommand([])
		} finally {
			output.restore()
			process.chdir(origCwd)
		}

		expect(output.logs.some((l) => l.includes('No traces found'))).toBe(true)
	})

	it('should list recent traces', async () => {
		const origCwd = process.cwd()
		process.chdir(testDir)

		const tracesDir = join(testDir, '.elsium/traces')
		mkdirSync(tracesDir, { recursive: true })
		writeFileSync(
			join(tracesDir, 'trc_001.json'),
			JSON.stringify([
				{
					id: 'span_1',
					traceId: 'trc_001',
					name: 'chat.complete',
					kind: 'llm',
					status: 'ok',
					startTime: Date.now(),
					endTime: Date.now() + 500,
					durationMs: 500,
					metadata: {},
					events: [],
				},
			]),
		)

		const { traceCommand } = await import('../commands/trace')
		const output = captureConsole()
		try {
			await traceCommand([])
		} finally {
			output.restore()
			process.chdir(origCwd)
		}

		expect(output.logs.some((l) => l.includes('Recent Traces'))).toBe(true)
		expect(output.logs.some((l) => l.includes('trc_001'))).toBe(true)
		expect(output.logs.some((l) => l.includes('OK'))).toBe(true)
	})

	it('should inspect a specific trace', async () => {
		const origCwd = process.cwd()
		process.chdir(testDir)

		const tracesDir = join(testDir, '.elsium/traces')
		mkdirSync(tracesDir, { recursive: true })
		writeFileSync(
			join(tracesDir, 'trc_002.json'),
			JSON.stringify([
				{
					id: 'span_root',
					traceId: 'trc_002',
					name: 'agent.run',
					kind: 'agent',
					status: 'ok',
					startTime: Date.now(),
					endTime: Date.now() + 1200,
					durationMs: 1200,
					metadata: { model: 'claude-sonnet-4-6' },
					events: [{ name: 'tool_call', timestamp: Date.now() + 300 }],
				},
				{
					id: 'span_child',
					traceId: 'trc_002',
					parentId: 'span_root',
					name: 'llm.complete',
					kind: 'llm',
					status: 'ok',
					startTime: Date.now() + 100,
					endTime: Date.now() + 800,
					durationMs: 700,
					metadata: {},
					events: [],
				},
			]),
		)

		const { traceCommand } = await import('../commands/trace')
		const output = captureConsole()
		try {
			await traceCommand(['trc_002'])
		} finally {
			output.restore()
			process.chdir(origCwd)
		}

		expect(output.logs.some((l) => l.includes('Trace: trc_002'))).toBe(true)
		expect(output.logs.some((l) => l.includes('Spans: 2'))).toBe(true)
		expect(output.logs.some((l) => l.includes('agent.run'))).toBe(true)
		expect(output.logs.some((l) => l.includes('llm.complete'))).toBe(true)
	})

	it('should error for non-existent trace', async () => {
		const origCwd = process.cwd()
		process.chdir(testDir)

		mkdirSync(join(testDir, '.elsium/traces'), { recursive: true })

		const { traceCommand } = await import('../commands/trace')
		const output = captureConsole()
		const origExit = process.exit
		let exitCode: number | undefined
		process.exit = ((code: number) => {
			exitCode = code
		}) as never

		try {
			await traceCommand(['nonexistent'])
		} finally {
			output.restore()
			process.exit = origExit
			process.chdir(origCwd)
		}

		expect(exitCode).toBe(1)
		expect(output.errors.some((e) => e.includes('Trace not found'))).toBe(true)
	})
})

describe('CLI - eval command', () => {
	it('should show usage when no file provided', async () => {
		const { evalCommand } = await import('../commands/eval')
		const output = captureConsole()
		try {
			await evalCommand([])
		} finally {
			output.restore()
		}

		expect(output.logs.some((l) => l.includes('Usage: elsium eval'))).toBe(true)
	})

	it('should error for non-existent eval file', async () => {
		const { evalCommand } = await import('../commands/eval')
		const output = captureConsole()
		const origExit = process.exit
		let exitCode: number | undefined
		process.exit = ((code: number) => {
			exitCode = code
		}) as never

		try {
			await evalCommand(['nonexistent.ts'])
		} finally {
			output.restore()
			process.exit = origExit
		}

		expect(exitCode).toBe(1)
		expect(output.errors.some((e) => e.includes('not found'))).toBe(true)
	})
})
