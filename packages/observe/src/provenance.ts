import { createHash } from 'node:crypto'

export interface ProvenanceRecord {
	id: string
	outputHash: string
	promptVersion: string
	modelVersion: string
	configHash: string
	inputHash: string
	timestamp: number
	traceId?: string
	metadata?: Record<string, unknown>
}

export interface ProvenanceTracker {
	record(data: {
		prompt: string
		model: string
		config: Record<string, unknown>
		input: string
		output: string
		traceId?: string
		metadata?: Record<string, unknown>
	}): ProvenanceRecord
	query(filter: {
		outputHash?: string
		promptVersion?: string
		modelVersion?: string
		traceId?: string
	}): ProvenanceRecord[]
	getLineage(outputHash: string): ProvenanceRecord[]
	readonly count: number
	clear(): void
}

function sha256(input: string): string {
	return createHash('sha256').update(input).digest('hex')
}

function matchesFilter(
	record: ProvenanceRecord,
	filter: { outputHash?: string; promptVersion?: string; modelVersion?: string; traceId?: string },
): boolean {
	if (filter.outputHash && record.outputHash !== filter.outputHash) return false
	if (filter.promptVersion && record.promptVersion !== filter.promptVersion) return false
	if (filter.modelVersion && record.modelVersion !== filter.modelVersion) return false
	if (filter.traceId && record.traceId !== filter.traceId) return false
	return true
}

export function createProvenanceTracker(): ProvenanceTracker {
	const records: ProvenanceRecord[] = []
	let idCounter = 0

	return {
		record(data): ProvenanceRecord {
			idCounter++
			const record: ProvenanceRecord = {
				id: `prov_${idCounter.toString(36)}_${Date.now().toString(36)}`,
				outputHash: sha256(data.output),
				promptVersion: sha256(data.prompt),
				modelVersion: sha256(data.model),
				configHash: sha256(JSON.stringify(data.config)),
				inputHash: sha256(data.input),
				timestamp: Date.now(),
				traceId: data.traceId,
				metadata: data.metadata,
			}

			records.push(record)
			return record
		},

		query(filter): ProvenanceRecord[] {
			return records.filter((r) => matchesFilter(r, filter))
		},

		getLineage(outputHash: string): ProvenanceRecord[] {
			// Find the record with this output hash
			const target = records.find((r) => r.outputHash === outputHash)
			if (!target?.traceId) return target ? [target] : []

			// Return all records sharing the same traceId, sorted by timestamp
			return records
				.filter((r) => r.traceId === target.traceId)
				.sort((a, b) => a.timestamp - b.timestamp)
		},

		get count(): number {
			return records.length
		},

		clear(): void {
			records.length = 0
		},
	}
}
