/**
 * Edge-runtime regression guard.
 *
 * Issue #41 documents the governance primitives that previously imported
 * `node:crypto` and therefore failed to load on Cloudflare Workers, Vercel
 * Edge, Deno Deploy, etc. After the Web Crypto migration, this test pins
 * the invariant: every file in the "governance + reliability" set MUST
 * NOT import from any `node:*` module.
 *
 * If you add a new governance primitive (signed payloads, integrity chains,
 * audit trails, idempotency keys, replay signing, etc.), add the file to
 * `GOVERNANCE_FILES` below.
 *
 * Modules that are intentionally Node-only (CLI, sqlite stores, fixtures,
 * dev-time recorders) are NOT listed here and are excluded by design — see
 * GOVERNANCE.md for the supported-runtime matrix.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(import.meta.dirname ?? __dirname, '../../..')

const GOVERNANCE_FILES = [
	'packages/core/src/web-crypto.ts',
	'packages/core/src/utils.ts',
	'packages/agents/src/identity.ts',
	'packages/agents/src/stores/integrity.ts',
	'packages/app/src/middleware.ts',
	'packages/observe/src/audit.ts',
	'packages/testing/src/replay-audit.ts',
	'packages/workflows/src/idempotent-checkpoint.ts',
]

describe('edge-runtime regression guard (issue #41)', () => {
	for (const relative of GOVERNANCE_FILES) {
		it(`${relative} imports zero node:* modules`, async () => {
			const src = await readFile(resolve(REPO_ROOT, relative), 'utf-8')
			// Match: import ... from 'node:...' OR from "node:..."
			expect(src).not.toMatch(/from\s+['"]node:/)
			// Also catch require('node:...')
			expect(src).not.toMatch(/require\(\s*['"]node:/)
		})
	}
})
