import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadDataset, loadDatasetFromCSV, loadDatasetFromJSON } from './dataset'

const TEST_DIR = join(import.meta.dirname, '__test-datasets__')

beforeAll(async () => {
	await mkdir(TEST_DIR, { recursive: true })
})

afterAll(async () => {
	await rm(TEST_DIR, { recursive: true, force: true })
})

describe('loadDatasetFromJSON', () => {
	it('loads object format with name and cases', async () => {
		const data = {
			name: 'test-suite',
			version: '1.0',
			cases: [
				{ name: 'case-1', input: 'hello', expected: 'world' },
				{ name: 'case-2', input: 'foo', expected: 'bar' },
			],
		}
		const filePath = join(TEST_DIR, 'object.json')
		await writeFile(filePath, JSON.stringify(data))

		const dataset = await loadDatasetFromJSON(filePath)

		expect(dataset.name).toBe('test-suite')
		expect(dataset.version).toBe('1.0')
		expect(dataset.cases).toHaveLength(2)
		expect(dataset.cases[0].name).toBe('case-1')
		expect(dataset.cases[0].input).toBe('hello')
		expect(dataset.cases[0].expected).toBe('world')
	})

	it('loads array format', async () => {
		const data = [
			{ name: 'case-1', input: 'hello', expected: 'world' },
			{ name: 'case-2', input: 'foo' },
		]
		const filePath = join(TEST_DIR, 'array.json')
		await writeFile(filePath, JSON.stringify(data))

		const dataset = await loadDatasetFromJSON(filePath)

		expect(dataset.name).toBe('')
		expect(dataset.cases).toHaveLength(2)
		expect(dataset.cases[1].expected).toBeUndefined()
	})

	it('uses custom field mapping', async () => {
		const data = [{ question: 'What is 2+2?', answer: '4', id: 'q1' }]
		const filePath = join(TEST_DIR, 'custom-fields.json')
		await writeFile(filePath, JSON.stringify(data))

		const dataset = await loadDatasetFromJSON(filePath, {
			inputField: 'question',
			expectedField: 'answer',
			nameField: 'id',
		})

		expect(dataset.cases[0].name).toBe('q1')
		expect(dataset.cases[0].input).toBe('What is 2+2?')
		expect(dataset.cases[0].expected).toBe('4')
	})
})

describe('loadDatasetFromCSV', () => {
	it('loads CSV with headers', async () => {
		const csv = 'name,input,expected\ncase-1,hello,world\ncase-2,foo,bar'
		const filePath = join(TEST_DIR, 'basic.csv')
		await writeFile(filePath, csv)

		const dataset = await loadDatasetFromCSV(filePath)

		expect(dataset.cases).toHaveLength(2)
		expect(dataset.cases[0].name).toBe('case-1')
		expect(dataset.cases[0].input).toBe('hello')
		expect(dataset.cases[0].expected).toBe('world')
	})

	it('loads CSV with custom field mapping', async () => {
		const csv = 'id,question,answer\nq1,What is 2+2?,4'
		const filePath = join(TEST_DIR, 'custom.csv')
		await writeFile(filePath, csv)

		const dataset = await loadDatasetFromCSV(filePath, {
			inputField: 'question',
			expectedField: 'answer',
			nameField: 'id',
		})

		expect(dataset.cases[0].name).toBe('q1')
		expect(dataset.cases[0].input).toBe('What is 2+2?')
		expect(dataset.cases[0].expected).toBe('4')
	})

	it('handles quoted fields', async () => {
		const csv = 'name,input,expected\ncase-1,"hello, world",result'
		const filePath = join(TEST_DIR, 'quoted.csv')
		await writeFile(filePath, csv)

		const dataset = await loadDatasetFromCSV(filePath)

		expect(dataset.cases[0].input).toBe('hello, world')
	})

	it('returns empty cases for header-only CSV', async () => {
		const csv = 'name,input,expected'
		const filePath = join(TEST_DIR, 'empty.csv')
		await writeFile(filePath, csv)

		const dataset = await loadDatasetFromCSV(filePath)

		expect(dataset.cases).toHaveLength(0)
	})
})

describe('loadDataset', () => {
	it('auto-detects JSON format', async () => {
		const data = [{ name: 'c1', input: 'hi' }]
		const filePath = join(TEST_DIR, 'auto.json')
		await writeFile(filePath, JSON.stringify(data))

		const dataset = await loadDataset(filePath)

		expect(dataset.cases).toHaveLength(1)
	})

	it('auto-detects CSV format', async () => {
		const csv = 'name,input,expected\nc1,hi,there'
		const filePath = join(TEST_DIR, 'auto.csv')
		await writeFile(filePath, csv)

		const dataset = await loadDataset(filePath)

		expect(dataset.cases).toHaveLength(1)
	})

	it('auto-detects JSONL format', async () => {
		const jsonl =
			'{"name":"c1","input":"hello","expected":"world"}\n{"name":"c2","input":"foo","expected":"bar"}'
		const filePath = join(TEST_DIR, 'auto.jsonl')
		await writeFile(filePath, jsonl)

		const dataset = await loadDataset(filePath)

		expect(dataset.cases).toHaveLength(2)
		expect(dataset.cases[0].name).toBe('c1')
		expect(dataset.cases[0].input).toBe('hello')
		expect(dataset.cases[1].name).toBe('c2')
	})

	it('throws for unsupported format', async () => {
		await expect(loadDataset('/tmp/data.xml')).rejects.toThrow('Unsupported dataset format')
	})
})
