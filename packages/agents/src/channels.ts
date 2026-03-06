import type { Agent } from './agent'
import type { SessionRouter } from './session'

export interface IncomingMessage {
	channelName: string
	userId: string
	text: string
	attachments?: ChannelAttachment[]
	metadata?: Record<string, unknown>
	raw?: unknown
}

export interface OutgoingMessage {
	text: string
	attachments?: ChannelAttachment[]
	metadata?: Record<string, unknown>
}

export interface ChannelAttachment {
	type: 'image' | 'audio' | 'document' | 'file'
	url?: string
	data?: string
	mimeType?: string
	name?: string
}

export interface ChannelAdapter {
	readonly name: string
	start(): Promise<void>
	stop(): Promise<void>
	send(userId: string, message: OutgoingMessage): Promise<void>
	onMessage(handler: (message: IncomingMessage) => void): void
}

export interface ChannelGatewayConfig {
	adapters: ChannelAdapter[]
	router: SessionRouter
	agent: Agent
	resolveAgent?: (message: IncomingMessage) => Agent | undefined
	onError?: (error: Error, message: IncomingMessage) => void
}

export interface ChannelGateway {
	start(): Promise<void>
	stop(): Promise<void>
	readonly adapters: ReadonlyMap<string, ChannelAdapter>
}

export interface WebhookChannelConfig {
	name: string
	onSend?: (userId: string, message: OutgoingMessage) => void | Promise<void>
}

export function createWebhookChannel(config: WebhookChannelConfig): ChannelAdapter & {
	receive(message: Omit<IncomingMessage, 'channelName'>): void
} {
	let messageHandler: ((message: IncomingMessage) => void) | null = null

	return {
		name: config.name,

		async start() {},

		async stop() {},

		async send(userId: string, message: OutgoingMessage) {
			await config.onSend?.(userId, message)
		},

		onMessage(handler: (message: IncomingMessage) => void) {
			messageHandler = handler
		},

		receive(message: Omit<IncomingMessage, 'channelName'>) {
			if (!messageHandler) return
			messageHandler({ ...message, channelName: config.name })
		},
	}
}

export function createChannelGateway(config: ChannelGatewayConfig): ChannelGateway {
	const adapterMap = new Map<string, ChannelAdapter>()
	for (const adapter of config.adapters) {
		if (
			adapter.name === '__proto__' ||
			adapter.name === 'constructor' ||
			adapter.name === 'prototype'
		)
			continue
		adapterMap.set(adapter.name, adapter)
	}

	function findAdapter(channelName: string): ChannelAdapter | undefined {
		return adapterMap.get(channelName)
	}

	async function handleIncoming(message: IncomingMessage) {
		const agent = config.resolveAgent?.(message) ?? config.agent

		try {
			const session = await config.router.resolve({
				channelName: message.channelName,
				userId: message.userId,
				agent,
			})

			const result = await session.send(message.text)
			const responseText = typeof result.message.content === 'string' ? result.message.content : ''

			const adapter = findAdapter(message.channelName)
			if (adapter && responseText) {
				await adapter.send(message.userId, { text: responseText })
			}
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err))
			try {
				config.onError?.(error, message)
			} catch {
				/* onError callback errors are swallowed */
			}
		}
	}

	for (const adapter of config.adapters) {
		adapter.onMessage(handleIncoming)
	}

	return {
		adapters: adapterMap,

		async start() {
			const startPromises = [...adapterMap.values()].map((a) => a.start())
			await Promise.all(startPromises)
		},

		async stop() {
			const stopPromises = [...adapterMap.values()].map((a) => a.stop())
			await Promise.all(stopPromises)
		},
	}
}
