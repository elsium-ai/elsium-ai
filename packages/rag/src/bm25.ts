import type { Chunk, RetrievalResult } from './types'

export interface BM25Index {
	index(chunks: Chunk[]): void
	search(query: string, topK?: number): RetrievalResult[]
}

interface DocEntry {
	chunk: Chunk
	termFreqs: Map<string, number>
	length: number
}

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^\w\s]/g, ' ')
		.split(/\s+/)
		.filter((t) => t.length > 0)
}

export function createBM25Index(options?: { k1?: number; b?: number }): BM25Index {
	const k1 = options?.k1 ?? 1.2
	const b = options?.b ?? 0.75

	const docs: DocEntry[] = []
	const docFreqs = new Map<string, number>()
	let avgDocLength = 0

	function addDoc(chunk: Chunk): void {
		const tokens = tokenize(chunk.content)
		const termFreqs = new Map<string, number>()

		for (const token of tokens) {
			termFreqs.set(token, (termFreqs.get(token) ?? 0) + 1)
		}

		// Update doc frequencies
		for (const term of termFreqs.keys()) {
			docFreqs.set(term, (docFreqs.get(term) ?? 0) + 1)
		}

		docs.push({ chunk, termFreqs, length: tokens.length })
	}

	function recalcAvgLength(): void {
		if (docs.length === 0) {
			avgDocLength = 0
			return
		}
		avgDocLength = docs.reduce((sum, d) => sum + d.length, 0) / docs.length
	}

	function idf(term: string): number {
		const df = docFreqs.get(term) ?? 0
		const n = docs.length
		if (df === 0) return 0
		return Math.log((n - df + 0.5) / (df + 0.5) + 1)
	}

	function scoreSingle(doc: DocEntry, queryTerms: string[]): number {
		let score = 0

		for (const term of queryTerms) {
			const tf = doc.termFreqs.get(term) ?? 0
			if (tf === 0) continue

			const termIdf = idf(term)
			const numerator = tf * (k1 + 1)
			const denominator = tf + k1 * (1 - b + b * (doc.length / avgDocLength))

			score += termIdf * (numerator / denominator)
		}

		return score
	}

	return {
		index(chunks: Chunk[]): void {
			for (const chunk of chunks) {
				addDoc(chunk)
			}
			recalcAvgLength()
		},

		search(query: string, topK = 5): RetrievalResult[] {
			if (docs.length === 0) return []

			const queryTerms = tokenize(query)
			if (queryTerms.length === 0) return []

			const scored: Array<{ chunk: Chunk; score: number }> = []

			for (const doc of docs) {
				const score = scoreSingle(doc, queryTerms)
				if (score > 0) {
					scored.push({ chunk: doc.chunk, score })
				}
			}

			scored.sort((a, b) => b.score - a.score)

			return scored.slice(0, topK).map((s) => ({
				chunk: s.chunk,
				score: s.score,
				distance: 0,
			}))
		},
	}
}
