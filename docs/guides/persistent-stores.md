# Persistent stores guide

ElsiumAI is a framework, not an application. It ships **ports** (interfaces) and **in-memory reference adapters** for state-carrying primitives. Production durability is your call — you implement the port against the backend you already run.

> **Why no bundled DB drivers?** A framework that pulls in `better-sqlite3` forces a native binding on everyone, even on the dev who runs DynamoDB in prod. A framework that pulls in `pg` forces a connection-pool model. We do not make those choices for you. The ports are stable; the implementations are yours.

This guide gives **copy-paste examples** for the most common backends. They are example code, not reference implementations the framework supports. Read, copy, adapt.

---

## Ports overview

| Port | Where | Memory adapter (built-in) |
|---|---|---|
| `CostStore` | `elsium-ai` (G2 cost engine via O2b) | `createLocalCostStore()` |
| `ApprovalStore` | `elsium-ai` (G4 approval chain) | `createInMemoryApprovalStore()` |
| `CheckpointStore` | `elsium-ai` (workflows resumable) | `createInMemoryCheckpointStore()` |
| `IdempotentCheckpointStore` extends `CheckpointStore` | `elsium-ai` (R1 idempotent step exec) | `createInMemoryIdempotentCheckpointStore()` |

You implement the same port shape against your backend. The rest of the framework reads through that port and does not care which backend you chose.

---

## SQLite adapter for `CostStore`

Install your favorite SQLite client. We use `better-sqlite3` here only as an example — `node:sqlite` (Node ≥ 22), `bun:sqlite`, or `kysely` work too.

```bash
npm install better-sqlite3
```

```ts
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type {
  CostAttribution,
  CostBucket,
  CostDimensionKey,
  CostRecord,
  CostStore,
  ReservationToken,
  TimeWindow,
} from 'elsium-ai'

interface SqliteCostStoreOptions {
  readonly path: string
  readonly reservationTtlMs?: number
}

export function createSqliteCostStore(options: SqliteCostStoreOptions): CostStore {
  const db = new Database(options.path)
  db.exec(`
    CREATE TABLE IF NOT EXISTS cost_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      cost REAL NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      model TEXT NOT NULL,
      tenant TEXT, agent TEXT, user TEXT, feature TEXT,
      workflow TEXT, workflow_step TEXT, trace_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_records_timestamp ON cost_records(timestamp);
    CREATE INDEX IF NOT EXISTS idx_records_tenant ON cost_records(tenant);
    CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      attribution_json TEXT NOT NULL,
      reserved_amount REAL NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `)

  const ttl = options.reservationTtlMs ?? 60_000
  const dim = (key: CostDimensionKey): string =>
    key === 'workflowStep' ? 'workflow_step' : key === 'traceId' ? 'trace_id' : key

  return {
    async record(rec: CostRecord): Promise<void> {
      db.prepare(
        `INSERT INTO cost_records (
           timestamp, cost, input_tokens, output_tokens, model,
           tenant, agent, user, feature, workflow, workflow_step, trace_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        rec.timestamp,
        rec.cost,
        rec.inputTokens,
        rec.outputTokens,
        rec.attribution.model,
        rec.attribution.tenant ?? null,
        rec.attribution.agent ?? null,
        rec.attribution.user ?? null,
        rec.attribution.feature ?? null,
        rec.attribution.workflow ?? null,
        rec.attribution.workflowStep ?? null,
        rec.attribution.traceId ?? null,
      )
    },

    async aggregate(
      by: CostDimensionKey,
      filter?: Partial<CostAttribution>,
      window?: TimeWindow,
    ): Promise<readonly CostBucket[]> {
      const column = dim(by)
      const where: string[] = [`${column} IS NOT NULL`]
      const args: Array<string | number> = []
      for (const [k, v] of Object.entries(filter ?? {})) {
        if (v === undefined) continue
        where.push(`${dim(k as CostDimensionKey)} = ?`)
        args.push(v as string)
      }
      if (window) {
        where.push('timestamp BETWEEN ? AND ?')
        args.push(window.fromMs, window.toMs)
      }
      const rows = db
        .prepare(
          `SELECT ${column} AS key,
                  SUM(cost) AS cost,
                  SUM(input_tokens + output_tokens) AS tokens,
                  COUNT(*) AS calls,
                  MIN(timestamp) AS firstAt,
                  MAX(timestamp) AS lastAt
           FROM cost_records
           WHERE ${where.join(' AND ')}
           GROUP BY ${column}`,
        )
        .all(...args)
      return rows as readonly CostBucket[]
    },

    async reserve(attribution: CostAttribution, estimatedCost: number): Promise<ReservationToken> {
      // SQLite reservation: use a simple TTL row. For concurrent writers, wrap in a
      // transaction and validate the row count in a single round-trip.
      db.prepare('DELETE FROM reservations WHERE expires_at <= ?').run(Date.now())
      const id = `rsv_${randomUUID()}`
      const expiresAt = Date.now() + ttl
      db.prepare(
        'INSERT INTO reservations (id, attribution_json, reserved_amount, expires_at) VALUES (?, ?, ?, ?)',
      ).run(id, JSON.stringify(attribution), estimatedCost, expiresAt)
      return { id, attribution, reservedAmount: estimatedCost, expiresAt }
    },

    async commit(token: ReservationToken, actualCost: number): Promise<void> {
      const tx = db.transaction((tok: ReservationToken, cost: number) => {
        const removed = db.prepare('DELETE FROM reservations WHERE id = ?').run(tok.id)
        if (removed.changes === 0) {
          throw new Error(`reservation ${tok.id} not found or expired`)
        }
        db.prepare(
          `INSERT INTO cost_records (
             timestamp, cost, input_tokens, output_tokens, model,
             tenant, agent, user, feature, workflow, workflow_step, trace_id
           ) VALUES (?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          Date.now(),
          cost,
          tok.attribution.model,
          tok.attribution.tenant ?? null,
          tok.attribution.agent ?? null,
          tok.attribution.user ?? null,
          tok.attribution.feature ?? null,
          tok.attribution.workflow ?? null,
          tok.attribution.workflowStep ?? null,
          tok.attribution.traceId ?? null,
        )
      })
      tx(token, actualCost)
    },

    async release(token: ReservationToken): Promise<void> {
      db.prepare('DELETE FROM reservations WHERE id = ?').run(token.id)
    },
  }
}
```

Use it as a drop-in replacement for `createLocalCostStore()`:

```ts
const costStore = createSqliteCostStore({ path: './cost.db' })
// pass to whatever consumes the port
```

---

## Postgres adapter for `ApprovalStore`

```bash
npm install pg
```

```ts
import { Pool } from 'pg'
import type {
  ApprovalDecision,
  ApprovalState,
  ApprovalStore,
  ApprovalStoreFilter,
  ChainStatus,
} from 'elsium-ai'

export function createPostgresApprovalStore(connectionString: string): ApprovalStore {
  const pool = new Pool({ connectionString })

  // Run once at startup:
  //   CREATE TABLE approvals (
  //     request_id TEXT PRIMARY KEY,
  //     state JSONB NOT NULL,
  //     status TEXT NOT NULL,
  //     current_stage TEXT,
  //     updated_at BIGINT NOT NULL
  //   );
  //   CREATE INDEX idx_approvals_status_stage ON approvals(status, current_stage);

  return {
    async put(state: ApprovalState): Promise<void> {
      const stageName = state.stages[state.currentStage]?.name ?? null
      await pool.query(
        `INSERT INTO approvals (request_id, state, status, current_stage, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (request_id) DO UPDATE SET
           state = EXCLUDED.state,
           status = EXCLUDED.status,
           current_stage = EXCLUDED.current_stage,
           updated_at = EXCLUDED.updated_at`,
        [state.request.id, state, state.status, stageName, state.updatedAt],
      )
    },

    async get(requestId: string): Promise<ApprovalState | null> {
      const r = await pool.query<{ state: ApprovalState }>(
        'SELECT state FROM approvals WHERE request_id = $1',
        [requestId],
      )
      return r.rows[0]?.state ?? null
    },

    async listPending(filter?: ApprovalStoreFilter): Promise<readonly ApprovalState[]> {
      const where: string[] = []
      const args: Array<string | ChainStatus> = []
      const status = filter?.status ?? 'pending'
      where.push(`status = $${where.length + 1}`)
      args.push(status)
      if (filter?.stage) {
        where.push(`current_stage = $${where.length + 1}`)
        args.push(filter.stage)
      }
      const r = await pool.query<{ state: ApprovalState }>(
        `SELECT state FROM approvals WHERE ${where.join(' AND ')} ORDER BY updated_at ASC`,
        args,
      )
      return r.rows.map((row) => row.state)
    },

    async resolveStage(
      requestId: string,
      stageName: string,
      decision: ApprovalDecision,
    ): Promise<ApprovalState> {
      // Postgres exemplifies the CAS / SELECT FOR UPDATE pattern that the
      // in-memory adapter does trivially. Use a transaction:
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const r = await client.query<{ state: ApprovalState }>(
          'SELECT state FROM approvals WHERE request_id = $1 FOR UPDATE',
          [requestId],
        )
        const existing = r.rows[0]?.state
        if (!existing) {
          await client.query('ROLLBACK')
          throw new Error(`approval ${requestId} not found`)
        }
        const stageIdx = existing.stages.findIndex((s) => s.name === stageName)
        if (stageIdx === -1 || existing.stages[stageIdx].status !== 'pending') {
          await client.query('ROLLBACK')
          throw new Error(`stage ${stageName} not pending`)
        }
        const stages = existing.stages.map((s, i) =>
          i === stageIdx
            ? {
                ...s,
                status: decision.approved ? 'approved' : 'denied',
                decision,
                resolvedAt: Date.now(),
              }
            : s,
        )
        const next = { ...existing, stages, updatedAt: Date.now() }
        await client.query(
          'UPDATE approvals SET state = $1, updated_at = $2 WHERE request_id = $3',
          [next, next.updatedAt, requestId],
        )
        await client.query('COMMIT')
        return next as ApprovalState
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    },
  }
}
```

The `SELECT … FOR UPDATE` row lock is the production-grade primitive that the in-memory adapter does not need. This is exactly the kind of decision the framework should not make for you — it depends on your Postgres version, your isolation level, your row-contention profile.

---

## Redis adapter for `IdempotentCheckpointStore`

```bash
npm install ioredis
```

```ts
import Redis from 'ioredis'
import type {
  IdempotentCheckpointStore,
  StepExecutionRecord,
  WorkflowCheckpoint,
} from 'elsium-ai'

export function createRedisIdempotentStore(url: string): IdempotentCheckpointStore {
  const redis = new Redis(url)
  const ckptKey = (id: string) => `wf:ckpt:${id}`
  const stepKey = (wf: string, name: string, key: string) => `wf:step:${wf}:${name}:${key}`
  const wfStepsKey = (wf: string) => `wf:steps:${wf}` // set of step keys for this workflow

  return {
    async save(checkpoint: WorkflowCheckpoint): Promise<void> {
      await redis.set(ckptKey(checkpoint.workflowId), JSON.stringify(checkpoint))
    },
    async load(workflowId: string): Promise<WorkflowCheckpoint | null> {
      const v = await redis.get(ckptKey(workflowId))
      return v ? (JSON.parse(v) as WorkflowCheckpoint) : null
    },
    async delete(workflowId: string): Promise<void> {
      const stepKeys = await redis.smembers(wfStepsKey(workflowId))
      const keys = [ckptKey(workflowId), wfStepsKey(workflowId), ...stepKeys]
      if (keys.length > 0) await redis.del(...keys)
    },
    async list(workflowName?: string): Promise<WorkflowCheckpoint[]> {
      const stream = redis.scanStream({ match: 'wf:ckpt:*' })
      const out: WorkflowCheckpoint[] = []
      for await (const keys of stream) {
        for (const key of keys as string[]) {
          const v = await redis.get(key)
          if (!v) continue
          const ckpt = JSON.parse(v) as WorkflowCheckpoint
          if (!workflowName || ckpt.workflowName === workflowName) out.push(ckpt)
        }
      }
      return out
    },

    async getStepResult(wf, stepName, idempotencyKey) {
      const v = await redis.get(stepKey(wf, stepName, idempotencyKey))
      return v ? (JSON.parse(v) as StepExecutionRecord) : null
    },
    async recordStepResult(record: StepExecutionRecord): Promise<void> {
      const key = stepKey(record.workflowId, record.stepName, record.idempotencyKey)
      // SETNX gives single-writer semantics: if the key already exists, do not
      // overwrite. This is the contract — first commit wins, prevents lost updates
      // under concurrent retries.
      const ok = await redis.set(key, JSON.stringify(record), 'NX')
      if (ok !== 'OK') return // another instance wrote it first; that's fine
      await redis.sadd(wfStepsKey(record.workflowId), key)
    },
    async listStepHistory(workflowId: string): Promise<readonly StepExecutionRecord[]> {
      const keys = await redis.smembers(wfStepsKey(workflowId))
      if (keys.length === 0) return []
      const values = await redis.mget(keys)
      const out: StepExecutionRecord[] = []
      for (const v of values) {
        if (v) out.push(JSON.parse(v) as StepExecutionRecord)
      }
      return out
    },
  }
}
```

`SET … NX` is the Redis way to do single-writer-wins for idempotency. Postgres would use `INSERT … ON CONFLICT DO NOTHING`. SQLite would use `INSERT OR IGNORE`. Same contract, three different mechanisms — the framework declares the contract, you pick the mechanism.

---

## Testing your adapter

Reuse the framework's test patterns. The in-memory adapter that ships with the framework is the reference behavior — implement your adapter so the same test assertions pass:

```ts
// my-adapter.test.ts
import { describe, expect, it } from 'vitest'
import { createSqliteCostStore } from './sqlite-cost-store'

describe('SqliteCostStore — contract tests', () => {
  it('aggregates by model after recording two entries', async () => {
    const store = createSqliteCostStore({ path: ':memory:' })
    await store.record({
      attribution: { model: 'gpt-5' },
      cost: 0.5, inputTokens: 100, outputTokens: 50, timestamp: 1000,
    })
    await store.record({
      attribution: { model: 'gpt-5' },
      cost: 0.3, inputTokens: 80, outputTokens: 40, timestamp: 2000,
    })
    const buckets = await store.aggregate('model')
    expect(buckets[0].cost).toBeCloseTo(0.8)
    expect(buckets[0].calls).toBe(2)
  })

  // ... mirror the other tests from cost-store.test.ts in elsium-ai's source
})
```

The framework's `cost-store.test.ts`, `approval-chain.test.ts`, `idempotent-checkpoint.test.ts` are your reference suite. Copy the tests, swap the constructor, and you have a portable contract suite for your adapter.

---

## The commitment

We will **not** publish `@elsium-ai/store-sqlite`, `@elsium-ai/store-postgres`, or `@elsium-ai/store-redis` packages. They would force a tooling and configuration choice on you that depends on your environment. The ports stay simple; your adapter stays yours.

If you publish a reusable adapter, we will gladly link it from this document. Open an issue with `[adapter]` in the title.
