import { describe, expect, it, vi } from 'vitest'

vi.mock('pdf-parse', () => ({
	default: vi.fn(async () => ({
		text: 'Page 1 content\fPage 2 content\fPage 3 content',
		numpages: 3,
		info: { Title: 'Test PDF' },
	})),
}))

import { pdfLoader } from './pdf-loader'

describe('pdfLoader', () => {
	it('extracts text from PDF buffer', async () => {
		const loader = pdfLoader()
		const doc = await loader.load('test.pdf', Buffer.from('fake-pdf'))

		expect(doc.content).toContain('Page 1 content')
		expect(doc.metadata.source).toBe('test.pdf')
		expect(doc.metadata.type).toBe('pdf')
		expect(doc.metadata.title).toBe('Test PDF')
		expect(doc.metadata.pageCount).toBe(3)
		expect(doc.id).toMatch(/^doc_/)
	})

	it('respects maxPages option', async () => {
		const loader = pdfLoader({ maxPages: 2 })
		const doc = await loader.load('test.pdf', Buffer.from('fake-pdf'))

		const pages = doc.content.split('\n\n---\n\n')
		expect(pages).toHaveLength(2)
		expect(pages[0]).toBe('Page 1 content')
		expect(pages[1]).toBe('Page 2 content')
	})

	it('uses custom page break marker', async () => {
		const loader = pdfLoader({ maxPages: 2, pageBreakMarker: '\n===\n' })
		const doc = await loader.load('test.pdf', Buffer.from('fake-pdf'))

		expect(doc.content).toContain('===')
	})

	it('accepts Uint8Array input', async () => {
		const loader = pdfLoader()
		const doc = await loader.load('test.pdf', new Uint8Array([1, 2, 3]))

		expect(doc.metadata.type).toBe('pdf')
	})
})

describe('pdfLoader without pdf-parse', () => {
	it('throws clear error when pdf-parse is not installed', async () => {
		vi.doUnmock('pdf-parse')
		vi.resetModules()

		vi.doMock('pdf-parse', () => {
			throw new Error('Cannot find module')
		})

		const { pdfLoader: freshLoader } = await import('./pdf-loader')
		const loader = freshLoader()

		await expect(loader.load('test.pdf', Buffer.from('data'))).rejects.toThrow(
			'pdf-parse is required',
		)
	})
})
