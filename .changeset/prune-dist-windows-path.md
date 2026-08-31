---
"elsium-ai": patch
---

Fix a Windows-only crash in the `prune-dist` build step, where `URL.pathname`
produced an invalid `C:\C:\...` path.
