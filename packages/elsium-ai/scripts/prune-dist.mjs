/**
 * Prune dist/ to ship only files reachable via the package's `exports` field.
 *
 * Background — issue #35:
 *  - `bun build` (with `--minify`) emits the bundled `index.js` plus a number
 *    of `index-<hash>.js` chunks. The bundle does NOT reference the chunks
 *    (they're remnants of bun's internal splitting), so the chunks ship as
 *    dead bytes (~344 KB).
 *  - `tsc --emitDeclarationOnly` emits per-file `.d.ts` files into subpath
 *    directories (`dist/core/`, `dist/agents/`, etc.). The umbrella's
 *    `exports` field only declares `"."`, so those subdirectories cannot be
 *    imported (`elsium-ai/core` does not resolve). They ship as dead bytes
 *    too (~580 KB).
 *
 * This script deletes both classes of dead weight after build. The published
 * tarball then contains only `index.js`, `index.d.ts`, `index.d.ts.map`, and
 * nothing else — every byte is reachable via `exports."."`.
 */

import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Use fileURLToPath rather than URL.pathname: on Windows the latter yields
// "/C:/…/dist/", which Node re-resolves against the current drive into an
// invalid "C:\C:\…" path. fileURLToPath produces the correct native path on
// every platform.
const DIST = fileURLToPath(new URL('../dist/', import.meta.url))
const CHUNK_RX = /^index-[a-z0-9]{8}\.js$/

let prunedDirs = 0
let prunedChunks = 0

for (const entry of readdirSync(DIST, { withFileTypes: true })) {
	const full = join(DIST, entry.name)
	if (entry.isDirectory()) {
		rmSync(full, { recursive: true, force: true })
		prunedDirs++
		continue
	}
	if (CHUNK_RX.test(entry.name)) {
		rmSync(full, { force: true })
		prunedChunks++
	}
}

console.log(
	`prune-dist: removed ${prunedDirs} unreachable subdirectories and ${prunedChunks} unused chunk files.`,
)
