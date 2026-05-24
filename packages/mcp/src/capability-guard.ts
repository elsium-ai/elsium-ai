import {
	type CapabilityCheckReason,
	type CapabilityToken,
	type CapabilityVerifier,
	canUseMcp,
} from '@elsium-ai/core'
import { ElsiumError } from '@elsium-ai/core'
import type { MCPClient } from './client'

export interface MCPCapabilityDenialEvent {
	tokenId: string
	subject: string
	server: string
	tool: string
	reason: CapabilityCheckReason | undefined
	detail?: string
}

export interface CapabilityGuardedMCPOptions {
	token: CapabilityToken
	server: string
	verifier?: CapabilityVerifier
	onDeny?: (event: MCPCapabilityDenialEvent) => void
}

function buildDenial(
	options: CapabilityGuardedMCPOptions,
	tool: string,
	reason: CapabilityCheckReason | undefined,
	detail: string | undefined,
): ElsiumError {
	if (options.onDeny) {
		options.onDeny({
			tokenId: options.token.tokenId,
			subject: options.token.subject.agent,
			server: options.server,
			tool,
			reason,
			detail,
		})
	}
	return new ElsiumError({
		code: 'AUTH_ERROR',
		message: `capability denied for MCP call ${options.server}/${tool}: ${reason}${detail ? ` — ${detail}` : ''}`,
		retryable: false,
		metadata: { tokenId: options.token.tokenId, server: options.server, tool, reason },
	})
}

export function createCapabilityGuardedMCPClient(
	client: MCPClient,
	options: CapabilityGuardedMCPOptions,
): MCPClient {
	const inner = client

	return {
		connect: () => inner.connect(),
		disconnect: () => inner.disconnect(),
		listTools: () => inner.listTools(),
		toElsiumTools: () => inner.toElsiumTools(),
		listResources: () => inner.listResources(),
		readResource: (uri) => inner.readResource(uri),
		listPrompts: () => inner.listPrompts(),
		getPrompt: (name, args) => inner.getPrompt(name, args),
		get connected() {
			return inner.connected
		},
		async callTool(name, args) {
			if (options.verifier) {
				const tokenCheck = options.verifier.verifyToken(options.token)
				if (!tokenCheck.valid) {
					throw buildDenial(options, name, tokenCheck.reason, tokenCheck.detail)
				}
			}

			const scopeCheck = canUseMcp(options.token, { server: options.server, tool: name })
			if (!scopeCheck.allowed) {
				throw buildDenial(options, name, scopeCheck.reason, scopeCheck.detail)
			}

			return inner.callTool(name, args)
		},
	}
}
