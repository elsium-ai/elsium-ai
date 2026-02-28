import { createHash } from 'node:crypto'
import type { CompletionRequest } from '@elsium-ai/core'

export interface PromptSnapshot {
	name: string
	request: {
		system?: string
		messages: Array<{ role: string; content: string }>
		model?: string
	}
	outputHash: string
	timestamp: string
}

export interface SnapshotStore {
	get(name: string): PromptSnapshot | undefined
	set(name: string, snapshot: PromptSnapshot): void
	getAll(): PromptSnapshot[]
	toJSON(): string
}

export function createSnapshotStore(existing?: PromptSnapshot[]): SnapshotStore {
	const snapshots = new Map<string, PromptSnapshot>()

	if (existing) {
		for (const s of existing) {
			snapshots.set(s.name, s)
		}
	}

	return {
		get(name: string) {
			return snapshots.get(name)
		},

		set(name: string, snapshot: PromptSnapshot) {
			snapshots.set(name, snapshot)
		},

		getAll() {
			return Array.from(snapshots.values())
		},

		toJSON() {
			return JSON.stringify(Array.from(snapshots.values()), null, 2)
		},
	}
}

export function hashOutput(output: string): string {
	return createHash('sha256').update(output).digest('hex')
}

export interface SnapshotTestResult {
	name: string
	status: 'new' | 'match' | 'changed'
	previousHash?: string
	currentHash: string
	output: string
}

export async function testSnapshot(
	name: string,
	store: SnapshotStore,
	runner: () => Promise<string>,
	request?: Partial<CompletionRequest>,
): Promise<SnapshotTestResult> {
	const output = await runner()
	const currentHash = hashOutput(output)
	const existing = store.get(name)

	const snapshot: PromptSnapshot = {
		name,
		request: {
			system: request?.system,
			messages:
				request?.messages?.map((m) => ({
					role: m.role,
					content: typeof m.content === 'string' ? m.content : '[complex]',
				})) ?? [],
			model: request?.model,
		},
		outputHash: currentHash,
		timestamp: new Date().toISOString(),
	}

	if (!existing) {
		store.set(name, snapshot)
		return { name, status: 'new', currentHash, output }
	}

	if (existing.outputHash === currentHash) {
		return {
			name,
			status: 'match',
			previousHash: existing.outputHash,
			currentHash,
			output,
		}
	}

	store.set(name, snapshot)
	return {
		name,
		status: 'changed',
		previousHash: existing.outputHash,
		currentHash,
		output,
	}
}
