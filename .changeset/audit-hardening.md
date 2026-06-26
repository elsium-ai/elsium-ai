---
'@elsium-ai/app': patch
---

Bump `hono` to `^4.12.21` to resolve published security advisories affecting `<4.12.21`, including a high-severity CORS issue where the middleware reflects any `Origin` with credentials when `origin` defaults to the wildcard (GHSA-88fw-hqm2-52qc), plus several moderate advisories (IPv6 deny-rule bypass, `serve-static` path traversal on Windows, JWT scheme acceptance, cookie sanitization, and others). Consumers installing `@elsium-ai/app` now resolve the patched `hono` floor.
