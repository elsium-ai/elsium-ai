import { generateId } from '@elsium-ai/core'
import type { Chunk, ChunkingConfig, Document } from './types'

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

	if (overlap >= maxSize) {
		throw new Error('overlap must be less than maxChunkSize')
	}

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

	if (overlap >= maxSize) {
		throw new Error('overlap must be less than maxChunkSize')
	}

	function fixedSizeSplit(text: string): string[] {
		const parts: string[] = []
		for (let i = 0; i < text.length; i += maxSize - overlap) {
			parts.push(text.slice(i, i + maxSize))
		}
		return parts
	}

	function handleOversizedSplit(
		split: string,
		sepIndex: number,
	): { chunks: string[]; remainder: string } {
		if (split.length > maxSize) {
			return { chunks: splitRecursive(split, sepIndex + 1), remainder: '' }
		}
		return { chunks: [], remainder: split }
	}

	function mergeSplits(splits: string[], separator: string, sepIndex: number): string[] {
		const result: string[] = []
		let current = ''

		for (const split of splits) {
			const candidate = current ? current + separator + split : split

			if (candidate.length <= maxSize) {
				current = candidate
				continue
			}

			if (current) result.push(current)

			const { chunks, remainder } = handleOversizedSplit(split, sepIndex)
			result.push(...chunks)
			current = remainder
		}

		if (current) result.push(current)
		return result
	}

	function splitRecursive(text: string, sepIndex: number): string[] {
		if (text.length <= maxSize) return [text]
		if (sepIndex >= separators.length) return fixedSizeSplit(text)

		const separator = separators[sepIndex]
		const splits = separator === '' ? [text] : text.split(separator)
		return mergeSplits(splits, separator, sepIndex)
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

	function gatherGroup(
		sentences: string[],
		startIdx: number,
	): { group: string[]; nextIdx: number } {
		const group: string[] = []
		let length = 0
		let i = startIdx

		while (i < sentences.length) {
			const nextLen = length + sentences[i].length + (group.length > 0 ? 1 : 0)
			if (nextLen > maxSize && group.length > 0) break
			group.push(sentences[i])
			length = nextLen
			i++
		}

		return { group, nextIdx: i }
	}

	function applyOverlap(
		i: number,
		sentences: string[],
		group: string[],
		chunkCount: number,
	): number {
		if (overlapSentences <= 0 || i >= sentences.length) return i

		let next = Math.max(i - overlapSentences, chunkCount > 0 ? i - overlapSentences : 0)
		if (next <= (chunkCount > 1 ? sentences.indexOf(group[0]) : -1)) {
			next = sentences.indexOf(group[group.length - 1]) + 1
		}
		return next
	}

	function buildSentenceChunk(
		document: Document,
		group: string[],
		index: number,
		searchStart: number,
	): Chunk {
		const content = group.join(' ')
		const startChar = document.content.indexOf(group[0], searchStart)
		const actualStart = startChar >= 0 ? startChar : 0

		return {
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
		}
	}

	return {
		chunk(document: Document): Chunk[] {
			const sentences = splitSentences(document.content)
			if (sentences.length === 0) return []

			const chunks: Chunk[] = []
			let i = 0
			let index = 0

			while (i < sentences.length) {
				const { group, nextIdx } = gatherGroup(sentences, i)
				i = nextIdx

				const searchStart =
					chunks.length > 0 ? (chunks[chunks.length - 1].metadata.endChar as number) : 0
				chunks.push(buildSentenceChunk(document, group, index, searchStart))
				index++

				i = applyOverlap(i, sentences, group, chunks.length)
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
