import { generateId } from '@elsium-ai/core'
import type { Chunk, ChunkingConfig, ChunkingStrategy, Document } from './types'

export interface Chunker {
	chunk(document: Document): Chunk[]
}

// ─── Fixed Size ──────────────────────────────────────────────────

export function fixedSizeChunker(options?: {
	maxChunkSize?: number
	overlap?: number
}): Chunker {
	const maxSize = options?.maxChunkSize ?? 512
	const overlap = options?.overlap ?? 0

	return {
		chunk(document: Document): Chunk[] {
			const { content } = document
			if (content.length === 0) return []

			const chunks: Chunk[] = []
			let startChar = 0
			let index = 0

			while (startChar < content.length) {
				const endChar = Math.min(startChar + maxSize, content.length)
				const chunkContent = content.slice(startChar, endChar)

				chunks.push({
					id: generateId('chk'),
					content: chunkContent,
					documentId: document.id,
					index,
					metadata: {
						startChar,
						endChar,
						tokenEstimate: Math.ceil(chunkContent.length / 4),
					},
				})

				index++
				startChar = endChar - overlap

				if (startChar >= content.length) break
				if (endChar === content.length) break
			}

			return chunks
		},
	}
}

// ─── Recursive ───────────────────────────────────────────────────

const DEFAULT_SEPARATORS = ['\n\n', '\n', '. ', ' ', '']

export function recursiveChunker(options?: {
	maxChunkSize?: number
	overlap?: number
	separators?: string[]
}): Chunker {
	const maxSize = options?.maxChunkSize ?? 512
	const overlap = options?.overlap ?? 0
	const separators = options?.separators ?? DEFAULT_SEPARATORS

	function splitRecursive(text: string, sepIndex: number): string[] {
		if (text.length <= maxSize) return [text]
		if (sepIndex >= separators.length) {
			// fallback to fixed-size split
			const parts: string[] = []
			for (let i = 0; i < text.length; i += maxSize - overlap) {
				parts.push(text.slice(i, i + maxSize))
			}
			return parts
		}

		const separator = separators[sepIndex]
		const splits = separator === '' ? [text] : text.split(separator)

		const result: string[] = []
		let current = ''

		for (const split of splits) {
			const candidate = current ? current + separator + split : split

			if (candidate.length <= maxSize) {
				current = candidate
			} else {
				if (current) result.push(current)

				if (split.length > maxSize) {
					const subParts = splitRecursive(split, sepIndex + 1)
					result.push(...subParts)
					current = ''
				} else {
					current = split
				}
			}
		}

		if (current) result.push(current)
		return result
	}

	return {
		chunk(document: Document): Chunk[] {
			const parts = splitRecursive(document.content, 0)
			let charOffset = 0

			return parts.map((content, index) => {
				const startChar = document.content.indexOf(content, charOffset)
				const actualStart = startChar >= 0 ? startChar : charOffset
				charOffset = actualStart + content.length

				return {
					id: generateId('chk'),
					content,
					documentId: document.id,
					index,
					metadata: {
						startChar: actualStart,
						endChar: actualStart + content.length,
						tokenEstimate: Math.ceil(content.length / 4),
					},
				}
			})
		},
	}
}

// ─── Sentence ────────────────────────────────────────────────────

export function sentenceChunker(options?: {
	maxChunkSize?: number
	overlap?: number
}): Chunker {
	const maxSize = options?.maxChunkSize ?? 512
	const overlapSentences = options?.overlap ?? 1

	function splitSentences(text: string): string[] {
		return text
			.split(/(?<=[.!?])\s+/)
			.map((s) => s.trim())
			.filter((s) => s.length > 0)
	}

	return {
		chunk(document: Document): Chunk[] {
			const sentences = splitSentences(document.content)
			if (sentences.length === 0) return []

			const chunks: Chunk[] = []
			let i = 0
			let index = 0

			while (i < sentences.length) {
				const group: string[] = []
				let length = 0

				while (i < sentences.length) {
					const nextLen = length + sentences[i].length + (group.length > 0 ? 1 : 0)
					if (nextLen > maxSize && group.length > 0) break

					group.push(sentences[i])
					length = nextLen
					i++
				}

				const content = group.join(' ')
				const startChar = document.content.indexOf(
					group[0],
					chunks.length > 0 ? (chunks[chunks.length - 1].metadata.endChar as number) : 0,
				)
				const actualStart = startChar >= 0 ? startChar : 0

				chunks.push({
					id: generateId('chk'),
					content,
					documentId: document.id,
					index,
					metadata: {
						startChar: actualStart,
						endChar: actualStart + content.length,
						tokenEstimate: Math.ceil(content.length / 4),
						sentenceCount: group.length,
					},
				})

				index++

				// Apply overlap by stepping back
				if (overlapSentences > 0 && i < sentences.length) {
					i = Math.max(i - overlapSentences, chunks.length > 0 ? i - overlapSentences : 0)
					if (i <= (chunks.length > 1 ? sentences.indexOf(group[0]) : -1)) {
						i = sentences.indexOf(group[group.length - 1]) + 1
					}
				}
			}

			return chunks
		},
	}
}

// ─── Factory ─────────────────────────────────────────────────────

export function getChunker(config: ChunkingConfig): Chunker {
	switch (config.strategy) {
		case 'fixed-size':
			return fixedSizeChunker({
				maxChunkSize: config.maxChunkSize,
				overlap: config.overlap,
			})
		case 'recursive':
			return recursiveChunker({
				maxChunkSize: config.maxChunkSize,
				overlap: config.overlap,
			})
		case 'sentence':
			return sentenceChunker({
				maxChunkSize: config.maxChunkSize,
				overlap: config.overlap,
			})
	}
}
