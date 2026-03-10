import { generateId } from '@elsium-ai/core'
import type { Document, DocumentMetadata, LoaderType } from './types'

export interface DocumentLoader {
	load(source: string, content: string): Document
}

function createDocument(content: string, metadata: DocumentMetadata): Document {
	return {
		id: generateId('doc'),
		content,
		metadata,
	}
}

// ─── Plain Text ──────────────────────────────────────────────────

export function textLoader(): DocumentLoader {
	return {
		load(source: string, content: string): Document {
			return createDocument(content, {
				source,
				type: 'text',
			})
		},
	}
}

// ─── Markdown ────────────────────────────────────────────────────

export function markdownLoader(): DocumentLoader {
	return {
		load(source: string, content: string): Document {
			const title = extractMarkdownTitle(content)

			return createDocument(content, {
				source,
				type: 'markdown',
				title,
			})
		},
	}
}

function extractMarkdownTitle(content: string): string | undefined {
	const match = content.match(/^#\s+(.+)$/m)
	return match?.[1]?.trim()
}

// ─── HTML ────────────────────────────────────────────────────────

export function htmlLoader(): DocumentLoader {
	return {
		load(source: string, content: string): Document {
			const plainText = stripHtml(content)
			const title = extractHtmlTitle(content)

			return createDocument(plainText, {
				source,
				type: 'html',
				title,
			})
		},
	}
}

function stripHtml(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, '')
		.replace(/<style[\s\S]*?<\/style>/gi, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#039;/g, "'")
		.replace(/\s+/g, ' ')
		.trim()
}

function extractHtmlTitle(html: string): string | undefined {
	const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
	return match?.[1]?.trim()
}

// ─── JSON ────────────────────────────────────────────────────────

function extractItemText(item: unknown, contentField: string): string {
	if (typeof item === 'string') return item
	if (typeof item === 'object' && item !== null) {
		const text = (item as Record<string, unknown>)[contentField]
		if (typeof text === 'string') return text
		return JSON.stringify(item, null, 2)
	}
	return ''
}

function extractMetadataFields(parsed: unknown, metadataFields: string[]): Record<string, unknown> {
	const extra: Record<string, unknown> = {}
	if (!Array.isArray(parsed) && typeof parsed === 'object' && parsed !== null) {
		for (const field of metadataFields) {
			if (field in (parsed as Record<string, unknown>)) {
				extra[field] = (parsed as Record<string, unknown>)[field]
			}
		}
	}
	return extra
}

export function jsonLoader(options?: {
	contentField?: string
	metadataFields?: string[]
}): DocumentLoader {
	const contentField = options?.contentField ?? 'content'
	const metadataFields = options?.metadataFields ?? []

	return {
		load(source: string, content: string): Document {
			const parsed = JSON.parse(content)
			const items = Array.isArray(parsed) ? parsed : [parsed]
			const texts = items.map((item) => extractItemText(item, contentField)).filter(Boolean)
			const extra = extractMetadataFields(parsed, metadataFields)

			return createDocument(texts.join('\n\n'), {
				source,
				type: 'json',
				...extra,
			})
		},
	}
}

// ─── CSV ─────────────────────────────────────────────────────────

export function csvLoader(options?: {
	separator?: string
	contentColumns?: string[]
}): DocumentLoader {
	const separator = options?.separator ?? ','
	const contentColumns = options?.contentColumns

	return {
		load(source: string, content: string): Document {
			const lines = content.split('\n').filter((l) => l.trim().length > 0)
			if (lines.length === 0) {
				return createDocument('', { source, type: 'csv' })
			}

			const headers = parseCSVLine(lines[0], separator)
			const rows = lines.slice(1).map((line) => parseCSVLine(line, separator))

			const columnsToUse = contentColumns ?? headers
			const columnIndices = columnsToUse.map((col) => headers.indexOf(col)).filter((i) => i >= 0)

			const textRows = rows.map((row) => {
				if (columnIndices.length > 0) {
					return columnIndices.map((i) => `${headers[i]}: ${row[i] ?? ''}`).join(', ')
				}
				return row.join(', ')
			})

			return createDocument(textRows.join('\n'), {
				source,
				type: 'csv',
				rowCount: rows.length,
				columns: headers,
			})
		},
	}
}

function parseCSVLine(line: string, separator: string): string[] {
	const result: string[] = []
	let current = ''
	let inQuotes = false

	for (let i = 0; i < line.length; i++) {
		const char = line[i]

		if (char === '"') {
			if (inQuotes && line[i + 1] === '"') {
				current += '"'
				i++
			} else {
				inQuotes = !inQuotes
			}
		} else if (char === separator && !inQuotes) {
			result.push(current.trim())
			current = ''
		} else {
			current += char
		}
	}

	result.push(current.trim())
	return result
}

// ─── Factory ─────────────────────────────────────────────────────

export function getLoader(type: LoaderType): DocumentLoader {
	switch (type) {
		case 'text':
			return textLoader()
		case 'markdown':
			return markdownLoader()
		case 'html':
			return htmlLoader()
		case 'json':
			return jsonLoader()
		case 'csv':
			return csvLoader()
		case 'pdf':
			return textLoader()
	}
}
