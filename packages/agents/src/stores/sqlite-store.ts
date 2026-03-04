import { createRequire } from 'node:module'
import type { Message } from '@elsium-ai/core'
import { createLogger } from '@elsium-ai/core'
import type { MemoryStore } from './memory-store'

const require = createRequire(import.meta.url)

const log = createLogger()

const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const TABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/

interface SqliteDatabase {
	prepare(sql: string): {
		run(...params: unknown[]): void
		all(...params: unknown[]): Record<string, unknown>[]
		get(...params: unknown[]): Record<string, unknown> | undefined
	}
	exec(sql: string): void
}

export interface SqliteMemoryStoreConfig {
	path: string
	tableName?: string
}

export function createSqliteMemoryStore(config: SqliteMemoryStoreConfig): MemoryStore {
	const { path, tableName = 'agent_memory' } = config

	if (BLOCKED_KEYS.has(tableName)) {
		throw new Error(`Invalid table name: ${tableName}`)
	}
	if (!TABLE_NAME_PATTERN.test(tableName)) {
		throw new Error(`Invalid table name format: ${tableName}`)
	}

	let db: SqliteDatabase | null = null
	let initPromise: Promise<SqliteDatabase> | null = null

	async function getDb(): Promise<SqliteDatabase> {
		if (db) return db
		if (initPromise) return initPromise

		initPromise = (async () => {
			try {
				const Database = require('better-sqlite3') as new (path: string) => SqliteDatabase
				db = new Database(path)
				db.exec(`
					CREATE TABLE IF NOT EXISTS ${tableName} (
						agent_id TEXT NOT NULL,
						idx INTEGER NOT NULL,
						role TEXT NOT NULL,
						content TEXT NOT NULL,
						metadata TEXT,
						created_at INTEGER NOT NULL DEFAULT (unixepoch()),
						PRIMARY KEY (agent_id, idx)
					)
				`)
				return db
			} catch (err) {
				initPromise = null
				log.error('Failed to initialize SQLite memory store', {
					error: err instanceof Error ? err.message : String(err),
				})
				throw new Error(
					'better-sqlite3 is required for SQLite memory store. Install it as a dependency.',
				)
			}
		})()

		return initPromise
	}

	return {
		async load(agentId: string): Promise<Message[]> {
			if (BLOCKED_KEYS.has(agentId)) return []

			const database = await getDb()
			const rows = database
				.prepare(`SELECT role, content, metadata FROM ${tableName} WHERE agent_id = ? ORDER BY idx`)
				.all(agentId)

			return rows.map((row) => {
				const msg: Message = {
					role: row.role as Message['role'],
					content: JSON.parse(row.content as string),
				}
				if (row.metadata) {
					msg.metadata = JSON.parse(row.metadata as string)
				}
				return msg
			})
		},

		async save(agentId: string, messages: Message[]): Promise<void> {
			if (BLOCKED_KEYS.has(agentId)) return

			const database = await getDb()
			database.prepare(`DELETE FROM ${tableName} WHERE agent_id = ?`).run(agentId)

			const insert = database.prepare(
				`INSERT INTO ${tableName} (agent_id, idx, role, content, metadata) VALUES (?, ?, ?, ?, ?)`,
			)

			for (let i = 0; i < messages.length; i++) {
				const msg = messages[i]
				insert.run(
					agentId,
					i,
					msg.role,
					JSON.stringify(msg.content),
					msg.metadata ? JSON.stringify(msg.metadata) : null,
				)
			}
		},

		async clear(agentId: string): Promise<void> {
			if (BLOCKED_KEYS.has(agentId)) return

			const database = await getDb()
			database.prepare(`DELETE FROM ${tableName} WHERE agent_id = ?`).run(agentId)
		},
	}
}
