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

	// Create directory tree
	const dirs = [
		'src/agents',
		'src/tools',
		'src/policies',
		'src/gateway',
		'src/workflows',
		'evals',
		'test/agents',
		'.elsium/baselines',
		'.elsium/recordings',
	]
	for (const dir of dirs) {
		mkdirSync(join(projectDir, dir), { recursive: true })
	}

	// Write all scaffold files
	const files: [string, string][] = [
		['package.json', packageJsonContent(projectName)],
		['tsconfig.json', tsconfigContent()],
		['biome.json', biomeJsonContent()],
		['.env.example', envExampleContent()],
		['.gitignore', gitignoreContent()],
		['elsium.config.ts', configContent()],
		['src/index.ts', indexContent()],
		['src/gateway/mesh.ts', meshContent()],
		['src/policies/default.ts', policiesContent()],
		['src/tools/example.ts', toolContent()],
		['src/agents/assistant.ts', agentContent()],
		['src/workflows/example.ts', workflowContent()],
		['evals/quality.eval.ts', qualityEvalContent()],
		['evals/determinism.eval.ts', determinismEvalContent()],
		['test/agents/assistant.test.ts', testContent()],
		['.elsium/baselines/.gitkeep', ''],
		['.elsium/recordings/.gitkeep', ''],
		['README.md', readmeContent(projectName)],
	]

	for (const [filePath, content] of files) {
		writeFileSync(join(projectDir, filePath), content)
	}

	console.log('  Created files:')
	for (const [filePath] of files) {
		console.log(`    ${projectName}/${filePath}`)
	}
	console.log()
	console.log('  Next steps:')
	console.log(`    cd ${projectName}`)
	console.log('    cp .env.example .env   # add your API keys')
	console.log('    bun install')
	console.log('    bun run dev')
	console.log()
}

function packageJsonContent(projectName: string): string {
	return `${JSON.stringify(
		{
			name: projectName,
			version: '0.1.0',
			type: 'module',
			scripts: {
				dev: 'elsium dev',
				start: 'bun src/index.ts',
				test: 'vitest run',
				eval: 'elsium eval evals/quality.eval.ts',
				'eval:determinism': 'elsium eval evals/determinism.eval.ts',
				lint: 'biome check .',
				format: 'biome check --write .',
			},
			dependencies: {
				'@elsium-ai/core': '^0.1.0',
				'@elsium-ai/gateway': '^0.1.0',
				'@elsium-ai/agents': '^0.1.0',
				'@elsium-ai/tools': '^0.1.0',
				'@elsium-ai/workflows': '^0.1.0',
				'@elsium-ai/observe': '^0.1.0',
				'@elsium-ai/app': '^0.1.0',
				zod: '^3.23.0',
			},
			devDependencies: {
				'@elsium-ai/testing': '^0.1.0',
				'@biomejs/biome': '^1.9.0',
				'@types/node': '^22.0.0',
				typescript: '^5.7.0',
				vitest: '^3.0.0',
			},
		},
		null,
		2,
	)}\n`
}

function tsconfigContent(): string {
	return `${JSON.stringify(
		{
			compilerOptions: {
				target: 'ESNext',
				module: 'ESNext',
				moduleResolution: 'bundler',
				strict: true,
				esModuleInterop: true,
				skipLibCheck: true,
				types: ['node'],
			},
			include: ['src', 'evals', 'test', 'elsium.config.ts'],
		},
		null,
		2,
	)}\n`
}

function biomeJsonContent(): string {
	return `${JSON.stringify(
		{
			$schema: 'https://biomejs.dev/schemas/1.9.0/schema.json',
			organizeImports: { enabled: true },
			linter: {
				enabled: true,
				rules: { recommended: true },
			},
			formatter: {
				enabled: true,
				indentStyle: 'tab',
				lineWidth: 100,
			},
		},
		null,
		2,
	)}\n`
}

function envExampleContent(): string {
	return `# Provider API keys — add at least one
ANTHROPIC_API_KEY=your-anthropic-key-here
OPENAI_API_KEY=your-openai-key-here
`
}

function gitignoreContent(): string {
	return `node_modules/
dist/
.env
.env.*
!.env.example
.elsium/recordings/*.json
`
}

function configContent(): string {
	return `import type { AppConfig } from '@elsium-ai/app'
import { env } from '@elsium-ai/core'

const config = {
\tgateway: {
\t\tproviders: {
\t\t\tanthropic: { apiKey: env('ANTHROPIC_API_KEY') },
\t\t},
\t\tdefaultModel: 'claude-sonnet-4-6',
\t},
\tobserve: {
\t\ttracing: true,
\t\tcostTracking: true,
\t},
\tserver: {
\t\tport: 3000,
\t},
} satisfies Omit<AppConfig, 'agents'>

export default config
`
}

function indexContent(): string {
	return `import { createApp } from '@elsium-ai/app'
import config from '../elsium.config'
import { assistant } from './agents/assistant'

const app = createApp({
\t...config,
\tagents: [assistant],
})

app.listen()
`
}

function meshContent(): string {
	return `import { createProviderMesh } from '@elsium-ai/gateway'
import { env } from '@elsium-ai/core'

export const mesh = createProviderMesh({
\tproviders: [
\t\t{ name: 'anthropic', config: { apiKey: env('ANTHROPIC_API_KEY') } },
\t\t{ name: 'openai', config: { apiKey: env('OPENAI_API_KEY') } },
\t],
\tstrategy: 'fallback',
\tcircuitBreaker: {
\t\tfailureThreshold: 3,
\t\tresetTimeoutMs: 30_000,
\t},
})
`
}

function policiesContent(): string {
	return `import { createPolicySet, modelAccessPolicy, costLimitPolicy } from '@elsium-ai/core'

export const policies = createPolicySet([
\tmodelAccessPolicy(['claude-sonnet-4-6', 'claude-haiku-4-5', 'gpt-4o']),
\tcostLimitPolicy(5.0),
])
`
}

function toolContent(): string {
	return `import { defineTool } from '@elsium-ai/tools'
import { z } from 'zod'

export const calculatorTool = defineTool({
\tname: 'calculator',
\tdescription: 'Add two numbers together',
\tinput: z.object({
\t\ta: z.number().describe('First number'),
\t\tb: z.number().describe('Second number'),
\t}),
\thandler: async ({ a, b }) => {
\t\treturn { result: a + b }
\t},
})
`
}

function agentContent(): string {
	return `import { defineAgent } from '@elsium-ai/agents'
import { mesh } from '../gateway/mesh'
import { calculatorTool } from '../tools/example'

export const assistant = defineAgent(
\t{
\t\tname: 'assistant',
\t\tsystem: 'You are a helpful AI assistant. Use the calculator tool for math questions.',
\t\tmodel: 'claude-sonnet-4-6',
\t\ttools: [calculatorTool],
\t\tguardrails: {
\t\t\tmaxIterations: 10,
\t\t\tsemantic: {
\t\t\t\trelevance: { enabled: true, threshold: 0.5 },
\t\t\t},
\t\t},
\t\tconfidence: {
\t\t\thallucinationRisk: true,
\t\t\trelevanceScore: true,
\t\t},
\t},
\t{ complete: (req) => mesh.complete(req) },
)
`
}

function workflowContent(): string {
	return `import { defineWorkflow, step } from '@elsium-ai/workflows'
import { assistant } from '../agents/assistant'
import { extractText } from '@elsium-ai/core'

export const researchWorkflow = defineWorkflow({
\tname: 'research-pipeline',
\tsteps: [
\t\tstep('research', {
\t\t\thandler: async (input: string) => {
\t\t\t\tconst result = await assistant.run(\`Research this topic: \${input}\`)
\t\t\t\treturn extractText(result.message.content)
\t\t\t},
\t\t}),
\t\tstep('summarise', {
\t\t\thandler: async (input: string) => {
\t\t\t\tconst result = await assistant.run(\`Summarise in two sentences: \${input}\`)
\t\t\t\treturn extractText(result.message.content)
\t\t\t},
\t\t}),
\t],
})
`
}

function qualityEvalContent(): string {
	return `import type { EvalSuiteConfig } from '@elsium-ai/testing'
import { assistant } from '../src/agents/assistant'
import { extractText } from '@elsium-ai/core'

export default {
\tname: 'quality',
\tcases: [
\t\t{
\t\t\tname: 'factual-answer',
\t\t\tinput: 'What is 2 + 2?',
\t\t\tcriteria: [{ type: 'contains', value: '4' }],
\t\t},
\t\t{
\t\t\tname: 'polite-greeting',
\t\t\tinput: 'Hello!',
\t\t\tcriteria: [{ type: 'contains', value: 'Hello' }],
\t\t},
\t],
\trunner: async (input) => {
\t\tconst result = await assistant.run(input)
\t\treturn extractText(result.message.content)
\t},
} satisfies EvalSuiteConfig
`
}

function determinismEvalContent(): string {
	return `import type { EvalSuiteConfig } from '@elsium-ai/testing'
import { assertDeterministic } from '@elsium-ai/testing'
import { assistant } from '../src/agents/assistant'
import { extractText } from '@elsium-ai/core'

export default {
\tname: 'determinism',
\tcases: [
\t\t{
\t\t\tname: 'stable-math',
\t\t\tinput: 'What is 2 + 2? Reply with just the number.',
\t\t},
\t],
\trunner: async (input) => {
\t\tconst result = await assertDeterministic(
\t\t\tasync () => {
\t\t\t\tconst res = await assistant.run(input)
\t\t\t\treturn extractText(res.message.content)
\t\t\t},
\t\t\t{ runs: 3, tolerance: 0 },
\t\t)
\t\treturn result.outputs[0]
\t},
} satisfies EvalSuiteConfig
`
}

function testContent(): string {
	return `import { describe, it, expect } from 'vitest'
import { mockProvider, createReplayRecorder, createReplayPlayer } from '@elsium-ai/testing'
import { defineAgent } from '@elsium-ai/agents'
import { calculatorTool } from '../../src/tools/example'

describe('assistant agent', () => {
\tit('should respond to a greeting', async () => {
\t\tconst mock = mockProvider({
\t\t\tresponses: [{ content: 'Hello! How can I help you today?' }],
\t\t})

\t\tconst agent = defineAgent(
\t\t\t{
\t\t\t\tname: 'test-assistant',
\t\t\t\tsystem: 'You are a helpful AI assistant.',
\t\t\t\tmodel: 'mock',
\t\t\t\ttools: [calculatorTool],
\t\t\t},
\t\t\t{ complete: (req) => mock.complete(req) },
\t\t)

\t\tconst result = await agent.run('Hello!')
\t\texpect(result.message.content).toContain('Hello')
\t\texpect(mock.callCount).toBe(1)
\t})

\tit('should replay recorded interactions', async () => {
\t\tconst recorder = createReplayRecorder()
\t\tconst mock = mockProvider({
\t\t\tresponses: [{ content: 'The answer is 4.' }],
\t\t})

\t\tconst wrappedComplete = recorder.wrap((req) => mock.complete(req))
\t\tawait wrappedComplete({
\t\t\tmodel: 'mock',
\t\t\tmessages: [{ role: 'user', content: [{ type: 'text', text: 'What is 2+2?' }] }],
\t\t})

\t\tconst player = createReplayPlayer(recorder.toJSON())
\t\tconst replayed = await player.complete({
\t\t\tmodel: 'mock',
\t\t\tmessages: [{ role: 'user', content: [{ type: 'text', text: 'What is 2+2?' }] }],
\t\t})

\t\texpect(replayed).toBeDefined()
\t})
})
`
}

function readmeContent(projectName: string): string {
	return `# ${projectName}

Built with [ElsiumAI](https://github.com/elsium-ai/elsium-ai).

## Quick start

\`\`\`bash
cp .env.example .env   # add your API keys
bun install
bun run dev
\`\`\`

## Scripts

| Command | Description |
| --- | --- |
| \`bun run dev\` | Start the dev server |
| \`bun run test\` | Run unit tests |
| \`bun run eval\` | Run quality eval suite |
| \`bun run eval:determinism\` | Run determinism eval |
| \`bun run lint\` | Lint with Biome |
| \`bun run format\` | Auto-format with Biome |

## Project structure

- **src/agents/** — Agent definitions with guardrails
- **src/tools/** — Tool schemas validated by Zod
- **src/policies/** — Policy sets (model allowlist, cost caps)
- **src/gateway/** — Provider mesh with circuit breaker
- **src/workflows/** — Multi-step workflows
- **evals/** — Eval suites (quality + determinism)
- **test/** — Unit tests with mock providers and replay
`
}
