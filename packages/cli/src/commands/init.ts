import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function initCommand(args: string[]) {
	const projectName = args[0] ?? 'my-elsium-app'
	const projectDir = join(process.cwd(), projectName)

	if (existsSync(projectDir)) {
		console.error(`Directory "${projectName}" already exists.`)
		process.exit(1)
	}

	console.log(`\n  Creating ElsiumAI project: ${projectName}\n`)

	mkdirSync(projectDir, { recursive: true })
	mkdirSync(join(projectDir, 'src'), { recursive: true })

	// package.json
	writeFileSync(
		join(projectDir, 'package.json'),
		`${JSON.stringify(
			{
				name: projectName,
				version: '0.1.0',
				type: 'module',
				scripts: {
					dev: 'bun --watch src/index.ts',
					start: 'bun src/index.ts',
					test: 'vitest run',
				},
				dependencies: {
					'@elsium-ai/core': '^0.1.0',
					'@elsium-ai/gateway': '^0.1.0',
					'@elsium-ai/agents': '^0.1.0',
					'@elsium-ai/tools': '^0.1.0',
					'@elsium-ai/app': '^0.1.0',
				},
				devDependencies: {
					'@elsium-ai/testing': '^0.1.0',
					'bun-types': '^1.3.0',
					typescript: '^5.7.0',
					vitest: '^3.0.0',
				},
			},
			null,
			2,
		)}\n`,
	)

	// tsconfig.json
	writeFileSync(
		join(projectDir, 'tsconfig.json'),
		`${JSON.stringify(
			{
				compilerOptions: {
					target: 'ESNext',
					module: 'ESNext',
					moduleResolution: 'bundler',
					strict: true,
					esModuleInterop: true,
					skipLibCheck: true,
					types: ['bun-types'],
				},
				include: ['src'],
			},
			null,
			2,
		)}\n`,
	)

	// .env.example
	writeFileSync(join(projectDir, '.env.example'), 'ANTHROPIC_API_KEY=your-api-key-here\n')

	// .gitignore
	writeFileSync(
		join(projectDir, '.gitignore'),
		'node_modules/\ndist/\n.env\n.env.*\n!.env.example\n',
	)

	// src/index.ts
	writeFileSync(
		join(projectDir, 'src/index.ts'),
		`import { createApp } from '@elsium-ai/app'
import { defineAgent } from '@elsium-ai/agents'
import { env } from '@elsium-ai/core'
import { gateway } from '@elsium-ai/gateway'

// Create a gateway to your LLM provider
const llm = gateway({
	provider: 'anthropic',
	model: 'claude-sonnet-4-6',
	apiKey: env('ANTHROPIC_API_KEY'),
})

// Define an agent
const assistant = defineAgent(
	{
		name: 'assistant',
		system: 'You are a helpful AI assistant.',
		model: 'claude-sonnet-4-6',
	},
	{ complete: (req) => llm.complete(req) },
)

// Create and start the app
const app = createApp({
	gateway: {
		providers: {
			anthropic: { apiKey: env('ANTHROPIC_API_KEY') },
		},
		defaultModel: 'claude-sonnet-4-6',
	},
	agents: [assistant],
	observe: {
		tracing: true,
		costTracking: true,
	},
	server: {
		port: 3000,
	},
})

app.listen()
`,
	)

	console.log('  Created files:')
	console.log(`    ${projectName}/package.json`)
	console.log(`    ${projectName}/tsconfig.json`)
	console.log(`    ${projectName}/.env.example`)
	console.log(`    ${projectName}/.gitignore`)
	console.log(`    ${projectName}/src/index.ts`)
	console.log()
	console.log('  Next steps:')
	console.log(`    cd ${projectName}`)
	console.log('    cp .env.example .env   # add your API key')
	console.log('    bun install')
	console.log('    bun run dev')
	console.log()
}
