import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { EvalCase } from './eval'

export interface EvalDataset {
	name: string
	version?: string
	cases: EvalCase[]
}

export interface DatasetLoaderOptions {
	inputField?: string
	expectedField?: string
	nameField?: string
	tagsField?: string
}

function mapRecordToCase(
	record: Record<string, unknown>,
	options?: DatasetLoaderOptions,
): EvalCase {
	const inputField = options?.inputField ?? 'input'
	const expectedField = options?.expectedField ?? 'expected'
	const nameField = options?.nameField ?? 'name'
	const tagsField = options?.tagsField ?? 'tags'

	const tags = record[tagsField]
	let parsedTags: string[] | undefined
	if (typeof tags === 'string') {
		parsedTags = tags
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean)
	} else if (Array.isArray(tags)) {
		parsedTags = tags.map(String)
	}

	return {
		name: String(record[nameField] ?? ''),
		input: String(record[inputField] ?? ''),
		expected: record[expectedField] !== undefined ? String(record[expectedField]) : undefined,
		tags: parsedTags,
	}
}

export async function loadDatasetFromJSON(
	path: string,
	options?: DatasetLoaderOptions,
): Promise<EvalDataset> {
	const content = await readFile(path, 'utf-8')
	const parsed = JSON.parse(content)

	if (Array.isArray(parsed)) {
		return {
			name: '',
			cases: parsed.map((record) => mapRecordToCase(record, options)),
		}
	}

	return {
		name: parsed.name ?? '',
		version: parsed.version,
		cases: (parsed.cases ?? []).map((record: Record<string, unknown>) =>
			mapRecordToCase(record, options),
		),
	}
}

function parseCSVLine(line: string): string[] {
	const fields: string[] = []
	let current = ''
	let inQuotes = false

	for (let i = 0; i < line.length; i++) {
		const char = line[i]
		if (inQuotes) {
			if (char === '"' && line[i + 1] === '"') {
				current += '"'
				i++
			} else if (char === '"') {
				inQuotes = false
			} else {
				current += char
			}
		} else if (char === '"') {
			inQuotes = true
		} else if (char === ',') {
			fields.push(current.trim())
			current = ''
		} else {
			current += char
		}
	}

	fields.push(current.trim())
	return fields
}

export async function loadDatasetFromCSV(
	path: string,
	options?: DatasetLoaderOptions,
): Promise<EvalDataset> {
	const content = await readFile(path, 'utf-8')
	const lines = content.split('\n').filter((line) => line.trim().length > 0)

	if (lines.length < 2) {
		return { name: '', cases: [] }
	}

	const headers = parseCSVLine(lines[0])
	const cases: EvalCase[] = []

	for (let i = 1; i < lines.length; i++) {
		const values = parseCSVLine(lines[i])
		const record: Record<string, unknown> = {}
		for (let j = 0; j < headers.length; j++) {
			record[headers[j]] = values[j] ?? ''
		}
		cases.push(mapRecordToCase(record, options))
	}

	return { name: '', cases }
}

async function loadDatasetFromJSONL(
	path: string,
	options?: DatasetLoaderOptions,
): Promise<EvalDataset> {
	const content = await readFile(path, 'utf-8')
	const lines = content.split('\n').filter((line) => line.trim().length > 0)
	const cases = lines.map((line) => mapRecordToCase(JSON.parse(line), options))
	return { name: '', cases }
}

export async function loadDataset(
	path: string,
	options?: DatasetLoaderOptions,
): Promise<EvalDataset> {
	const ext = extname(path).toLowerCase()

	switch (ext) {
		case '.json':
			return loadDatasetFromJSON(path, options)
		case '.csv':
			return loadDatasetFromCSV(path, options)
		case '.jsonl':
			return loadDatasetFromJSONL(path, options)
		default:
			throw new Error(`Unsupported dataset format: ${ext}`)
	}
}
