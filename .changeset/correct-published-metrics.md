---
"elsium-ai": patch
---

Correct the published size and test-count figures in the README.

The README carried three different bundle sizes — 470 KB in the badge, 412 KB
in the cross-runtime section, 349 KB in the performance table — and none
matched the shipped artifact. The umbrella bundle is 504 KB minified (548 KB
unpacked), and it has grown as packages were added; the old figures understated
it by up to 45%.

The test badge read 2430 against 2620 actual.

Also notes explicitly that the umbrella re-exports every package and therefore
grows with the framework, and that importing individual packages lets
tree-shaking drop what you do not use. That was implied by the architecture and
contradicted by a headline number.
