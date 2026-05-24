import {
	type CapabilityCheckReason,
	type CapabilityToken,
	type CapabilityVerifier,
	canQueryRag,
} from '@elsium-ai/core'
import { ElsiumError } from '@elsium-ai/core'
import type { RAGPipeline } from './pipeline'

export interface RagCapabilityDenialEvent {
	tokenId: string
	subject: string
	store?: string
	resultCount?: number
	reason: CapabilityCheckReason | undefined
	detail?: string
}

export interface CapabilityGuardedRagOptions {
	token: CapabilityToken
	verifier?: CapabilityVerifier
	store?: string
	onDeny?: (event: RagCapabilityDenialEvent) => void
}

function buildDenial(
	options: CapabilityGuardedRagOptions,
	resultCount: number | undefined,
	reason: CapabilityCheckReason | undefined,
	detail: string | undefined,
): ElsiumError {
	if (options.onDeny) {
		options.onDeny({
			tokenId: options.token.tokenId,
			subject: options.token.subject.agent,
			store: options.store,
			resultCount,
			reason,
			detail,
		})
	}
	return new ElsiumError({
		code: 'AUTH_ERROR',
		message: `capability denied for RAG query: ${reason}${detail ? ` — ${detail}` : ''}`,
		retryable: false,
		metadata: { tokenId: options.token.tokenId, store: options.store, reason },
	})
}

export function withRagCapability(
	pipeline: RAGPipeline,
	options: CapabilityGuardedRagOptions,
): RAGPipeline {
	const inner = pipeline

	return {
		ingest: (source, content) => inner.ingest(source, content),
		ingestDocument: (document) => inner.ingestDocument(document),
		clear: () => inner.clear(),
		count: () => inner.count(),
		get embeddingProvider() {
			return inner.embeddingProvider
		},
		get vectorStore() {
			return inner.vectorStore
		},

		async query(text, queryOptions) {
			if (options.verifier) {
				const tokenCheck = options.verifier.verifyToken(options.token)
				if (!tokenCheck.valid) {
					throw buildDenial(options, queryOptions?.topK, tokenCheck.reason, tokenCheck.detail)
				}
			}

			const scopeCheck = canQueryRag(options.token, {
				store: options.store,
				resultCount: queryOptions?.topK,
			})
			if (!scopeCheck.allowed) {
				throw buildDenial(options, queryOptions?.topK, scopeCheck.reason, scopeCheck.detail)
			}

			return inner.query(text, queryOptions)
		},
	}
}
