import { generateId } from '@elsium-ai/core'
import type { Agent } from './agent'
import type { Thread, ThreadStore } from './thread'
import { createThread, loadThread } from './thread'

export interface SessionRouterConfig {
	defaultAgent: Agent
	store?: ThreadStore
	concurrency?: 'serial' | 'parallel'
	sessionTimeout?: number
	onSessionCreated?: (session: SessionInfo) => void
	onSessionExpired?: (session: SessionInfo) => void
}

export interface SessionInfo {
	readonly sessionId: string
	readonly channelName: string
	readonly userId: string
	readonly agentName: string
	readonly createdAt: number
	readonly lastActiveAt: number
}

export interface SessionResolveOptions {
	channelName: string
	userId: string
	agent?: Agent
}

export interface SessionRouter {
	resolve(options: SessionResolveOptions): Promise<Thread>
	getSession(channelName: string, userId: string): SessionInfo | null
	listSessions(): SessionInfo[]
	endSession(channelName: string, userId: string): boolean
	endAllSessions(): void
}

interface MutableSession {
	sessionId: string
	channelName: string
	userId: string
	agent: Agent
	thread: Thread
	createdAt: number
	lastActiveAt: number
	lock: Promise<void> | null
	lockResolve: (() => void) | null
}

function sessionKey(channelName: string, userId: string): string {
	return `${channelName}::${userId}`
}

export function createSessionRouter(config: SessionRouterConfig): SessionRouter {
	const sessions = new Map<string, MutableSession>()
	const concurrency = config.concurrency ?? 'serial'
	const sessionTimeout = config.sessionTimeout ?? 0

	let cleanupTimer: ReturnType<typeof setInterval> | null = null
	if (sessionTimeout > 0) {
		cleanupTimer = setInterval(
			() => {
				const now = Date.now()
				for (const [key, session] of sessions) {
					if (now - session.lastActiveAt > sessionTimeout) {
						sessions.delete(key)
						try {
							config.onSessionExpired?.({
								sessionId: session.sessionId,
								channelName: session.channelName,
								userId: session.userId,
								agentName: session.agent.name,
								createdAt: session.createdAt,
								lastActiveAt: session.lastActiveAt,
							})
						} catch {
							/* callback errors are swallowed */
						}
					}
				}
			},
			Math.min(sessionTimeout, 60_000),
		)

		if (typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
			cleanupTimer.unref()
		}
	}

	function toPublicSession(session: MutableSession): SessionInfo {
		return {
			sessionId: session.sessionId,
			channelName: session.channelName,
			userId: session.userId,
			agentName: session.agent.name,
			createdAt: session.createdAt,
			lastActiveAt: session.lastActiveAt,
		}
	}

	async function createNewSession(
		key: string,
		channelName: string,
		userId: string,
		agent: Agent,
	): Promise<MutableSession> {
		const sessionId = generateId('sess')
		const threadId = `${channelName}-${userId}-${sessionId}`

		let thread: Thread | null = null
		if (config.store) {
			thread = await loadThread(threadId, { agent, store: config.store })
		}
		if (!thread) {
			thread = createThread({
				id: threadId,
				agent,
				metadata: { channelName, userId, sessionId },
				store: config.store,
			})
		}

		const now = Date.now()
		const session: MutableSession = {
			sessionId,
			channelName,
			userId,
			agent,
			thread,
			createdAt: now,
			lastActiveAt: now,
			lock: null,
			lockResolve: null,
		}

		sessions.set(key, session)

		try {
			config.onSessionCreated?.(toPublicSession(session))
		} catch {
			/* callback errors are swallowed */
		}

		return session
	}

	function wrapThreadWithConcurrency(session: MutableSession): Thread {
		if (concurrency !== 'serial') return session.thread

		const originalSend = session.thread.send.bind(session.thread)

		return {
			...session.thread,
			async send(input, options) {
				while (session.lock) {
					await session.lock
				}

				let unlock!: () => void
				session.lock = new Promise<void>((resolve) => {
					unlock = resolve
				})
				session.lockResolve = unlock

				try {
					const result = await originalSend(input, options)
					session.lastActiveAt = Date.now()
					return result
				} finally {
					session.lock = null
					session.lockResolve = null
					unlock()
				}
			},
		}
	}

	return {
		async resolve(options: SessionResolveOptions): Promise<Thread> {
			const agent = options.agent ?? config.defaultAgent
			const key = sessionKey(options.channelName, options.userId)

			let session = sessions.get(key)

			if (session && sessionTimeout > 0) {
				const now = Date.now()
				if (now - session.lastActiveAt > sessionTimeout) {
					sessions.delete(key)
					try {
						config.onSessionExpired?.(toPublicSession(session))
					} catch {
						/* callback errors are swallowed */
					}
					session = undefined
				}
			}

			if (!session) {
				session = await createNewSession(key, options.channelName, options.userId, agent)
			}

			session.lastActiveAt = Date.now()
			return wrapThreadWithConcurrency(session)
		},

		getSession(channelName: string, userId: string): SessionInfo | null {
			const session = sessions.get(sessionKey(channelName, userId))
			return session ? toPublicSession(session) : null
		},

		listSessions(): SessionInfo[] {
			return [...sessions.values()].map(toPublicSession)
		},

		endSession(channelName: string, userId: string): boolean {
			return sessions.delete(sessionKey(channelName, userId))
		},

		endAllSessions() {
			sessions.clear()
			if (cleanupTimer) {
				clearInterval(cleanupTimer)
				cleanupTimer = null
			}
		},
	}
}
