---
'@elsium-ai/testing': minor
---

Add three evaluation capabilities to `@elsium-ai/testing`, closing the gaps between the existing reference-free assertions and a full eval stack.

- **Classification metrics** — `runClassificationEval`, `computeClassificationReport`, `computeConfusionMatrix`, `formatClassificationReport`, `formatConfusionMatrix`. Score categorical outputs against labeled ground truth with precision / recall / F1 (per-label plus macro / micro / weighted averages), accuracy, and a confusion matrix. All divisions are zero-safe.
- **RAG eval (RAGAS-style)** — `runRagEval`, `faithfulness`, `answerRelevancy`, `contextPrecision`, `contextRecall`, `formatRagEvalReport`. Judge-based groundedness metrics combine with deterministic, reference-based retrieval precision / recall. Judge and reference metrics are independently optional per case.
- **Structured rubric LLM-as-a-judge** — `createRubricJudge`. Define a weighted multi-criterion rubric; the judge prompts for a per-criterion JSON score, parses it robustly (returning `score: 0` with a diagnostic reason on malformed output instead of throwing), and returns a normalized weighted score with a per-criterion breakdown. The result is a drop-in `LLMJudge`, usable directly in an `llm_judge` eval criterion. `generate` is any `(prompt) => Promise<string>`, keeping the judge backend-agnostic.

All additions are re-exported from the `elsium-ai` umbrella package. No existing types or APIs change.
