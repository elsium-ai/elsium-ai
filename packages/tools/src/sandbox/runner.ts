import { createProcessSandboxRunner } from './runner-process'
import { createWorkerSandboxRunner } from './runner-worker'
import type { SandboxConfig, SandboxRunner } from './types'

export function createSandboxRunner(
	config: SandboxConfig,
	defaultTimeoutMs: number,
): SandboxRunner {
	if (config.mode === 'worker') {
		return createWorkerSandboxRunner(config, defaultTimeoutMs)
	}
	if (config.mode === 'process') {
		return createProcessSandboxRunner(config, defaultTimeoutMs)
	}
	throw new Error(`Unknown sandbox mode: ${(config as { mode: string }).mode}`)
}

export { createWorkerSandboxRunner } from './runner-worker'
export { createProcessSandboxRunner } from './runner-process'
