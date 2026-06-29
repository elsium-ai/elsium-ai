---
"@elsium-ai/gateway": patch
---

Detect "enable / activate / turn on developer mode" jailbreak phrasing.

Found by the new `benchmarks/guardrail-detection.ts` harness: the developer-mode
jailbreak pattern only matched "developer mode enabled/activated/on", missing the
common "enable developer mode" phrasing. The pattern now covers both. With this
fix the internal adversarial benchmark reports 100% recall across 6 evasion
categories (plain, zero-width, homoglyph, spacing, uppercase, base64) with 0%
false positives on benign near-misses.
