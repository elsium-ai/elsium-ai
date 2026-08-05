---
"@elsium-ai/app": minor
---

Clear all 8 advisories reported by `bun audit` (5 high, 3 moderate).

Runtime dependencies of `@elsium-ai/app`:

- `hono` → `^4.13.0` — ReDoS in the CORS middleware via
  `Access-Control-Request-Headers` (GHSA-8j4g-w8fx-2239).
- `@hono/node-server` → `^2.1.0` — path traversal in `serve-static` on Windows
  via an encoded backslash (GHSA-frvp-7c67-39w9).

Toolchain advisories cleared by raising the existing root overrides: `fast-uri`
(three host-confusion advisories), `postcss` (source-map path traversal),
`js-yaml` (quadratic CPU via merge-key chains).

**Node.js ≥ 20 is now required by `@elsium-ai/app`.** `@hono/node-server` v2
raised its floor from 18.14.1 to 20, so the package now declares `engines`
accordingly. Node 20 has been the documented reference runtime since 0.13.0;
this makes the requirement explicit rather than implicit.

Also adds integration coverage for `app.listen()` over a real socket. Every
existing test drove `app.hono.fetch` directly, so nothing exercised the
`@hono/node-server` adapter — a breaking change there would have shipped
undetected.
