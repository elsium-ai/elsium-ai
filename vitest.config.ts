import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [tsconfigPaths()],
	test: {
		globals: true,
		environment: 'node',
		include: ['packages/*/src/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			include: ['packages/*/src/**/*.ts'],
			exclude: [
				'**/*.test.ts',
				'**/*.spec.ts',
				'**/index.ts',
				'**/types.ts',
				'packages/elsium-ai/**',
				'packages/cli/**',
				'packages/gateway/src/providers/anthropic.ts',
			],
			thresholds: {
				statements: 90,
				branches: 80,
				functions: 90,
				lines: 90,
			},
		},
	},
})
