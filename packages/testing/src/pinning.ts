import { createHash } from 'node:crypto'
import { ElsiumError } from '@elsium-ai/core'

export interface Pin {
	promptHash: string
	configHash: string
	outputHash: string
	outputText: string
	model?: string
	createdAt: number
}

export interface PinStore {
	get(key: string): Pin | undefined
	set(key: string, pin: Pin): void
	delete(key: string): boolean
	getAll(): Pin[]
	toJSON(): string
}

export interface PinResult {
	status: 'new' | 'match' | 'mismatch'
	pin: Pin
	previousPin?: Pin
}

function sha256(input: string): string {
	return createHash('sha256').update(input).digest('hex')
}

export function createPinStore(existing?: Pin[]): PinStore {
	const pins = new Map<string, Pin>()

	if (existing) {
		for (const pin of existing) {
			const key = `${pin.promptHash}:${pin.configHash}`
			pins.set(key, pin)
		}
	}

	return {
		get(key: string): Pin | undefined {
			return pins.get(key)
		},

		set(key: string, pin: Pin): void {
			pins.set(key, pin)
		},

		delete(key: string): boolean {
			return pins.delete(key)
		},

		getAll(): Pin[] {
			return Array.from(pins.values())
		},

		toJSON(): string {
			return JSON.stringify(Array.from(pins.values()), null, 2)
		},
	}
}

export async function pinOutput(
	name: string,
	store: PinStore,
	runner: () => Promise<string>,
	config: { prompt: string; model?: string; temperature?: number; seed?: number },
	options?: { assert?: boolean },
): Promise<PinResult> {
	const promptHash = sha256(config.prompt)
	const configHash = sha256(
		JSON.stringify({
			model: config.model,
			temperature: config.temperature,
			seed: config.seed,
		}),
	)
	const key = `${promptHash}:${configHash}`

	const output = await runner()
	const outputHash = sha256(output)

	const pin: Pin = {
		promptHash,
		configHash,
		outputHash,
		outputText: output,
		model: config.model,
		createdAt: Date.now(),
	}

	const existing = store.get(key)

	if (!existing) {
		store.set(key, pin)
		return { status: 'new', pin }
	}

	if (existing.outputHash === outputHash) {
		return { status: 'match', pin, previousPin: existing }
	}

	if (options?.assert) {
		throw ElsiumError.validation(
			`Pin mismatch for "${name}": expected hash ${existing.outputHash}, got ${outputHash}`,
		)
	}

	store.set(key, pin)
	return { status: 'mismatch', pin, previousPin: existing }
}
