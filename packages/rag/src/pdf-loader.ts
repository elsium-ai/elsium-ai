import { generateId } from '@elsium-ai/core'
import type { Document, DocumentMetadata } from './types'

export interface BinaryDocumentLoader {
	load(source: string, data: Buffer | Uint8Array): Promise<Document>
}

export interface PdfLoaderOptions {
	maxPages?: number
	pageBreakMarker?: string
}

export function pdfLoader(options?: PdfLoaderOptions): BinaryDocumentLoader {
	const pageBreakMarker = options?.pageBreakMarker ?? '\n\n---\n\n'

	return {
		async load(source: string, data: Buffer | Uint8Array): Promise<Document> {
			type PdfParseFn = (
				buffer: Buffer,
			) => Promise<{ text: string; numpages: number; info?: { Title?: string } }>

			let pdfParse: PdfParseFn

			try {
				const moduleName = 'pdf-parse'
				const mod = (await import(moduleName)) as { default?: PdfParseFn }
				pdfParse = mod.default ?? (mod as unknown as PdfParseFn)
			} catch {
				throw new Error('pdf-parse is required for PDF loading. Install it: npm install pdf-parse')
			}

			const buffer = Buffer.from(data)
			const result = await pdfParse(buffer)

			let text = result.text
			if (options?.maxPages && result.numpages > options.maxPages) {
				const pages = text.split(/\f/)
				text = pages.slice(0, options.maxPages).join(pageBreakMarker)
			}

			const metadata: DocumentMetadata = {
				source,
				type: 'pdf',
				title: result.info?.Title,
				pageCount: result.numpages,
			}

			return {
				id: generateId('doc'),
				content: text.trim(),
				metadata,
			}
		},
	}
}
