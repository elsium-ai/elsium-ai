import { defineConfig } from 'vitest/config'
import 'dotenv/config'

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		testTimeout: 60_000,
		fileParallelism: false,
	},
})
