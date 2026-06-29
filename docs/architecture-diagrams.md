# Architecture Diagrams

Visual reference for ElsiumAI's package layout, the agent runtime, and the
proposed phased guardrail pipeline.

> **Status legend**
> - Diagrams 1–3 describe the **current implementation** (as in `packages/`).
> - Diagrams 4–5 describe the **phased guardrail design**. The input-side
>   redaction stages (🟧 in diagram 5: input PII/secret redaction and tool-arg
>   secret redaction) are now implemented and opt-in via `AgentSecurityConfig`
>   (`redactInputSecrets`, `redactInputPii`, `redactToolArgSecrets`,
>   `injectionClassifier`) and `securityMiddleware({ redactInput })`.
> - Diagram 6 is the **consolidated current state** after the self-contained
>   guardrails and seed-propagation work landed. ★ marks what those changes added.

---

## 1. Layered architecture (packages & dependencies)

Shows how the monorepo packages stack up and depend on each other. Everything
descends to `@elsium-ai/core` (ports + types, backend-agnostic: in-memory only,
the user supplies durable adapters). `testing` sits apart because it wraps the
others without being a production dependency of anything.

```mermaid
graph TD
    subgraph EXPO["Exposure / consumption layer"]
        APP["@elsium-ai/app<br/>HTTP server · RBAC · auth · SSE · multi-tenant"]
        CLI["@elsium-ai/cli<br/>init · dev · eval · cost · traces · X-Ray"]
        CLIENT["@elsium-ai/client<br/>HTTP client + SSE parsing"]
        UMB["elsium-ai (umbrella)<br/>re-exports everything"]
    end

    subgraph ORCH["Orchestration layer"]
        AGENTS["@elsium-ai/agents<br/>defineAgent · executeLoop · ReAct<br/>memory · guardrails · approval · multi-agent"]
        WORKFLOWS["@elsium-ai/workflows<br/>DAG · parallel · branch · checkpoint · resumable"]
        MCP["@elsium-ai/mcp<br/>client + server · resources · prompts"]
    end

    subgraph CAP["Capabilities"]
        GATEWAY["@elsium-ai/gateway<br/>providers · mesh · middleware · cache · PII"]
        TOOLS["@elsium-ai/tools<br/>defineTool · Zod · sandbox · idempotency"]
        RAG["@elsium-ai/rag<br/>loaders · chunk · embed · vector · hybrid"]
        OBSERVE["@elsium-ai/observe<br/>spans · cost · audit · provenance · proofs"]
    end

    CORE["@elsium-ai/core<br/>types · errors · stream · policy engine · retry<br/>circuit breaker · dedup · tokens · capability · crypto · replay"]

    TESTING["@elsium-ai/testing<br/>mocks · evals · pinning · determinism · red-team"]

    APP --> AGENTS & WORKFLOWS & GATEWAY & TOOLS & RAG & OBSERVE
    CLI --> OBSERVE & UMB
    CLIENT --> CORE
    UMB -.re-export.-> AGENTS & WORKFLOWS & GATEWAY & TOOLS & RAG & OBSERVE & MCP & CLIENT & APP & TESTING

    AGENTS --> GATEWAY & TOOLS & CORE
    WORKFLOWS --> CORE
    MCP --> TOOLS & CORE
    GATEWAY --> CORE
    TOOLS --> CORE
    RAG --> CORE
    OBSERVE --> CORE
    TESTING --> GATEWAY & TOOLS & AGENTS & CORE

    classDef core fill:#1f2937,stroke:#60a5fa,color:#fff
    classDef test fill:#3b0764,stroke:#a78bfa,color:#fff
    class CORE core
    class TESTING test
```

---

## 2. Agent engine — inputs & outputs

The black-box view of an agent: the entry methods and configuration that go in,
the injected dependencies the engine relies on, and the result shapes that come
out. The engine itself is `defineAgent` → `executeLoop`.

```mermaid
graph LR
    subgraph IN["INPUTS"]
        I1["run(input: string)"]
        I2["chat(messages: Message[])"]
        I3["generate(input, zodSchema)"]
        I4["stream(input)"]
        CFG["AgentConfig<br/>name · system · model<br/>tools · memory · guardrails<br/>provider · apiKey · hooks · confidence"]
        OPT["AgentRunOptions<br/>signal · traceId · metadata(actor/role)"]
    end

    ENGINE(["defineAgent → executeLoop<br/>THE ENGINE"])

    subgraph DEPS["Injected dependencies"]
        D1["AgentDependencies.complete()<br/>= gateway / ProviderMesh / LLMProvider"]
        D2["toolMap (Tool[])"]
        D3["Memory store"]
    end

    subgraph OUT["OUTPUTS"]
        O1["AgentResult<br/>message · usage(tokens/cost/iterations)<br/>toolCalls[] · traceId · confidence?"]
        O2["AgentGenerateResult&lt;T&gt;<br/>data: T (validated) + result"]
        O3["AgentStream<br/>AsyncIterable&lt;AgentStreamEvent&gt;<br/>text_delta · tool_call · final"]
        O4["AgentTrace (replay / audit)"]
    end

    I1 & I2 & I3 & I4 --> ENGINE
    CFG --> ENGINE
    OPT --> ENGINE
    DEPS --> ENGINE
    ENGINE --> O1 & O2 & O3 & O4
```

---

## 3. The engine core — `executeLoop`

The actual ReAct loop every agent runs (`packages/agents/src/agent.ts:406`).
The LLM responds; if it requests tools they are executed and fed back into the
context; otherwise the response is finalized. Governance checks live *inside* the
loop (blue nodes), not around it — this is the framework's differentiator.

```mermaid
flowchart TD
    START(["run / chat"]) --> VIN["validateInputText<br/>(inputValidator + security)"]
    VIN --> SM{"config.states<br/>+ initialState?"}
    SM -->|yes| STATE["executeStateMachine"]
    SM -->|no| INIT["Init loop<br/>traceId · TraceRecorder<br/>conversationMessages =<br/>memory.getMessages() + input"]

    INIT --> LOOP{"iterations < maxIterations?"}
    LOOP -->|no| MAXERR["throw MAX_ITERATIONS"]

    LOOP -->|yes| GUARDS["Per-iteration guards<br/>checkAborted · checkBudget · checkDuration"]
    GUARDS --> BUILD["buildCompletionRequest<br/>messages + system + tools.toDefinition()"]
    BUILD --> LLM["resolvedDeps.complete(request)<br/>★ LLM CALL"]
    LLM --> REC["recorder.recordStep<br/>accumulate tokens · cost<br/>hook onMessage"]
    REC --> PUSH["push response.message"]

    PUSH --> DEC{"toolCalls > 0<br/>and stopReason == 'tool_use'?"}

    DEC -->|yes, use tools| TLOOP["executeToolCalls — per tool:"]
    TLOOP --> APPR["checkApprovalGate<br/>(human approval)"]
    APPR --> POL["checkRuntimePolicy<br/>(RBAC / permissions)"]
    POL --> EXEC["tool.execute(args)<br/>hooks onToolCall/onToolResult"]
    EXEC --> TMSG["push tool message<br/>(toolResults)"]
    TMSG --> LOOP

    DEC -->|no, final answer| PROC["processOutput"]
    PROC --> VOUT["validateOutput + sanitizeOutput"]
    VOUT --> SEM{"runSemanticValidation"}
    SEM -->|fail + autoRetry| FB["push feedback message"] --> LOOP
    SEM -->|ok| CONF["scoreConfidence"]
    CONF --> COMMIT["commitToMemory<br/>rememberTrace<br/>hook onComplete"]
    COMMIT --> RET(["return AgentResult"])
    STATE --> RET

    classDef llm fill:#7c2d12,stroke:#fb923c,color:#fff
    classDef gov fill:#1e3a8a,stroke:#93c5fd,color:#fff
    classDef out fill:#14532d,stroke:#4ade80,color:#fff
    class LLM llm
    class GUARDS,APPR,POL,SEM,VIN,VOUT gov
    class RET,COMMIT out
```

---

## 4. Guardrail verdict semantics (proposed)

Proposed unified contract so every guardrail speaks the same language. Each
guardrail's `evaluate()` returns one explicit verdict; the pipeline acts on it.
`transform` is how PII/secret redaction mutates content in place; `block` stops
the request before it reaches the LLM; `retry` (output phase only) re-injects
feedback into the loop.

```mermaid
flowchart LR
    IN["content enters<br/>a stage"] --> EV{"Guardrail.evaluate()"}
    EV -->|allow| NEXT["next stage"]
    EV -->|"transform (redact)"| MUT["mutate content"] --> NEXT
    EV -->|flag| LOG["audit + continue"] --> NEXT
    EV -->|route| RT["restrict allowed<br/>providers"] --> NEXT
    EV -->|block| STOP[["throw + audit<br/>never reaches the LLM"]]
    EV -->|"retry (output only)"| RTY["re-inject feedback<br/>into the loop"]

    classDef stop fill:#7f1d1d,stroke:#fca5a5,color:#fff
    classDef mut fill:#78350f,stroke:#fbbf24,color:#fff
    class STOP stop
    class MUT,RTY mut
```

Proposed contract sketch:

```typescript
type GuardrailPhase = 'input' | 'tool' | 'output'

interface Guardrail {
  name: string
  phase: GuardrailPhase
  evaluate(ctx: GuardrailContext): GuardrailVerdict | Promise<GuardrailVerdict>
}

type GuardrailVerdict =
  | { action: 'allow' }
  | { action: 'transform'; value: string }         // PII/secret redaction — mutate & continue
  | { action: 'flag'; reason: string }             // audit & continue (non-blocking)
  | { action: 'route'; allowProviders: string[] }  // jurisdiction (input only)
  | { action: 'block'; reason: string; severity }  // stop: throw + audit
  | { action: 'retry'; feedback: string }          // output only -> re-inject into loop
```

---

## 5. Full phased guardrail flow (proposed, integrated with the engine)

End-to-end view with the proposed guardrail pipeline wired into the existing
`executeLoop`. Guardrails run as an **ordered pipeline per phase**: the pipeline
accumulates `transform` results (progressively redacted text), stops at the first
`block`, and applies the sanitized content at the end of each phase.

🟩 already exists in the codebase · 🟧 new stage to be added

```mermaid
flowchart TD
    START(["agent.run / chat / stream / generate"]) --> P0

    subgraph P0["PHASE 0 · INPUT GUARDRAILS — ordered pipeline, pre-LLM"]
        direction TB
        G1["1· Schema / format<br/>inputValidator 🟩"] --> G2["2· Prompt injection<br/>regex 🟩 + LLM classifier 🟧"]
        G2 --> G3["3· Jailbreak detection 🟩"]
        G3 --> G4["4· Blocked patterns 🟩"]
        G4 --> G5["5· PII detect + classify<br/>PiiClassifier 🟩"]
        G5 --> G6["6· PII redaction of INPUT 🟧<br/>transform before the model"]
        G6 --> G7["7· Secret redaction of INPUT 🟧"]
        G7 --> G8["8· Data classification +<br/>Jurisdiction routing -> pick provider 🟩"]
    end

    P0 -->|"block"| BLK[["throw ElsiumError.validation<br/>+ audit · onViolation"]]
    P0 -->|"allow · input sanitized + provider chosen"| LOOPSTART

    subgraph LOOP["ENGINE · executeLoop"]
        LOOPSTART{"iterations < maxIterations?"} -->|no| MAXERR[["MAX_ITERATIONS"]]
        LOOPSTART -->|yes| LG["Loop guards 🟩<br/>abort · budget · duration"]
        LG --> LLM["LLM complete()<br/>provider per routing"]
        LLM --> REC["recordStep · tokens · cost 🟩"]
        REC --> DEC{"stopReason == tool_use?"}
    end

    DEC -->|yes| PT
    DEC -->|no| PO

    subgraph PT["PHASE 1 · TOOL GUARDRAILS — per tool call"]
        direction TB
        T1["Approval gate 🟩"] --> T2["Runtime policy / RBAC 🟩"]
        T2 --> T3["Arg validation + PII/secret in args 🟧"]
        T3 --> T4["tool.execute() 🟩"]
    end
    PT -->|"denied / block"| TDENY["result success=false"] --> LOOPSTART
    PT -->|"ok"| TRES["tool result -> conversation"] --> LOOPSTART

    subgraph PO["PHASE 2 · OUTPUT GUARDRAILS — pre-return"]
        direction TB
        O1["outputValidator 🟩"] --> O2["Output secret/PII redaction 🟩"]
        O2 --> O3["Semantic validation (LLM) 🟩"]
        O3 --> O4["Confidence scoring 🟩"]
    end
    PO -->|"retry -> feedback"| FB["push feedback msg"] --> LOOPSTART
    PO -->|"block"| BLK
    PO -->|"allow"| FIN["commitToMemory · trace · onComplete 🟩"]
    FIN --> RET(["AgentResult / Stream / data&lt;T&gt;"])

    classDef new fill:#78350f,stroke:#fbbf24,color:#fff
    classDef stop fill:#7f1d1d,stroke:#fca5a5,color:#fff
    class G6,G7,T3 new
    class BLK,MAXERR stop
```

### How the phases act

| Phase | When | Typical actions | On failure |
|-------|------|-----------------|------------|
| **0 · Input** | once, before the loop | redact PII/secrets, detect injection/jailbreak, classify + route | `block` -> never reaches the LLM |
| **Loop guards** | every iteration | abort / budget / duration | bounded throw |
| **1 · Tool** | before *each* `tool.execute()` | approval, RBAC, validate + redact args | `block` -> `result success=false`, loop continues |
| **2 · Output** | before returning the response | validate, redact, semantic, confidence | `retry` (re-inject) or `block` |

**Key design decisions:**
- The 8 input stages form an **ordered pipeline**: redaction (6, 7) runs *after*
  injection/jailbreak detection (2–4) and *before* routing (8), so classification
  and routing operate on already-sanitized text.
- The new stages (🟧) **reuse existing patterns** (`PII_PATTERNS`,
  `SECRET_PATTERNS`); they are hooked into pre-processing plus a new
  `sanitizeInput` entry point.
- Every verdict is **audited**, fitting the hash-chained audit trail in
  `@elsium-ai/observe`, so any `block`/`transform` is recorded.

---

## 6. Consolidated current state (self-contained guardrails + reproducibility)

End-to-end view of the engine after two changes landed: **self-sufficient
guardrails** (evasion-resistant detection, a built-in LLM guardrail, an open
extension port, input/tool-arg redaction) and **seed propagation** that makes the
reproducibility tooling usable end-to-end. ★ marks what these changes added.
The guiding principle across both: self-contained by default, with an open port —
the built-ins are enough; integrating an external tool is the caller's choice,
never a dependency.

```mermaid
flowchart TD
    IN(["agent.run / chat / generate / stream<br/>★ run(input, { seed })"]) --> PREP["prepareInput (engine)"]

    subgraph G0["INPUT GUARDRAILS — ordered pipeline"]
        direction TB
        NORM["★ Evasion-resistant normalization<br/>zero-width · homoglyphs · base64 · NFKC"]
        NORM --> HEUR["Heuristic detection<br/>injection · jailbreak · blocked"]
        HEUR --> PORT{"injectionClassifier?<br/>★ InputGuardrail port"}
        PORT -->|built-in| LLMG["★ createLLMGuardrail<br/>uses your gateway · 0 deps"]
        PORT -->|external opt-in| EXT["★ Lakera · NeMo · Presidio<br/>(caller's responsibility)"]
        PORT -->|none| H2["(heuristic only)"]
        LLMG --> RED
        EXT --> RED
        H2 --> RED
        RED["★ Input redaction<br/>secrets + PII (redactInputPii)"]
    end

    PREP --> G0
    G0 -->|malicious| BLK[["throw · never reaches the LLM"]]
    G0 -->|sanitized input| LOOP

    subgraph LOOP["ENGINE · executeLoop"]
        direction TB
        LG["guards: abort · budget · duration"] --> BUILD["buildCompletionRequest<br/>★ injects seed into every request"]
        BUILD --> LLM["LLM complete()"]
        LLM --> DEC{"tool_use?"}
        DEC -->|yes| TG
        DEC -->|no| OUT
    end

    subgraph TG["TOOL GUARDRAILS (per tool call)"]
        direction TB
        APPR["approval gate"] --> RBAC["runtime policy / RBAC"]
        RBAC --> ARG["★ redact secrets in args"]
        ARG --> EXEC["tool.execute()"]
    end
    TG --> LOOP

    subgraph OUT["OUTPUT GUARDRAILS"]
        OV["output validator + redaction"] --> SEM["semantic validation"]
        SEM --> CONF["confidence scoring"]
    end
    OUT --> RESULT(["AgentResult / Stream"])

    BUILD -.seed in requestHash.-> REPRO
    RESULT -.-> REPRO
    subgraph REPRO["REPRODUCIBILITY PLANE (★ enabled by seed)"]
        direction LR
        DET["assertDeterministic<br/>N runs · same seed"]
        PIN["pinOutput<br/>regression"]
        PROOF["signed ExecutionProof (Ed25519)<br/>-> elsium verify (offline)"]
    end

    classDef new fill:#78350f,stroke:#fbbf24,color:#fff
    classDef port fill:#1e3a8a,stroke:#93c5fd,color:#fff
    classDef stop fill:#7f1d1d,stroke:#fca5a5,color:#fff
    classDef repro fill:#134e4a,stroke:#5eead4,color:#fff
    class NORM,LLMG,RED,ARG,BUILD new
    class PORT,EXT port
    class BLK stop
    class DET,PIN,PROOF repro
```

**What changed:**
- **Input (self-contained guardrails):** evasion-resistant normalization runs
  before detection; `injectionClassifier` is a **port** (built-in LLM guardrail or
  your external integration); input PII/secret redaction closes the pipeline.
- **Tool calls:** secrets are redacted from arguments before execution and trace
  recording.
- **Engine (seed propagation):** `buildCompletionRequest` injects the seed into
  every request.
- **Reproducibility plane (enabled):** because the seed travels in every request,
  `assertDeterministic`, `pinOutput`, and signed `ExecutionProof`s (whose request
  hash includes the seed) now work end-to-end, verifiable offline with
  `elsium verify`.

---

## 7. Positioning view — differentiating core vs commodity ports

The same hexagonal model, but split by **product decision** instead of listing
every capability as an equal box. **Tier 1** is where Elsium is unique and the
built-in must be excellent (regulated environments — EU AI Act, audit). **Tier 2**
are commodity ports: the built-in exists to get started, and swapping in a
best-of-breed tool is expected — Elsium integrates there, it does not compete.

```mermaid
flowchart TB
    subgraph T1["TIER 1 — ELSIUM'S CORE"]
        direction TB
        subgraph NEC["necessary · table-stakes (everyone has this)"]
            RUNTIME["Agent runtime · workflows · MCP orchestration"]
        end
        subgraph DIFF["differentiating · why teams choose Elsium"]
            direction TB
            REPRO["★ Reproducibility & signed proofs<br/>seed · Ed25519 ExecutionProof · verify offline<br/><i>the unique core — nobody integrates this</i>"]
            GOV["Governance<br/>governed guardrails · policy/RBAC · hash-chained audit<br/><b>agent identity</b> + capability tokens"]
            EVALS["Evals as proof<br/>LLM-judge · classification · RAG eval · attestation"]
        end
    end

    T1 -. "core consumes via ports" .-> T2

    subgraph T2["TIER 2 — COMMODITY PORTS · integrate, don't compete · built-in = quick start, swap-in expected"]
        direction LR
        PL["LLM gateway<br/>built-in: multi-provider"] -.-> XL["Portkey · LiteLLM · OpenRouter"]
        PR["Vector / RAG<br/>built-in: BM25 + pgvector"] -.-> XR["Pinecone · Weaviate · Qdrant"]
        PO["Observability<br/>built-in: OTel + cost"] -.-> XO["LangSmith · Langfuse · Datadog"]
        PS["Persistence<br/>built-in: in-mem + SQLite"] -.-> XS["Redis · Postgres"]
        PA["<b>People auth / SSO</b> (humans)<br/>thin — push to swap-in"] -.-> XA["Auth0 · Entra ID · WorkOS"]
    end

    classDef hero fill:#0e7490,stroke:#67e8f9,color:#fff,stroke-width:4px
    classDef diff fill:#134e4a,stroke:#5eead4,color:#fff
    classDef nec fill:#334155,stroke:#94a3b8,color:#fff
    classDef port fill:#1e3a8a,stroke:#93c5fd,color:#fff
    classDef ext fill:#78350f,stroke:#fbbf24,color:#fff
    class REPRO hero
    class GOV,EVALS diff
    class RUNTIME nec
    class PL,PR,PO,PS,PA port
    class XL,XR,XO,XS,XA ext
```

**Reading it:**
- **Tier 1 splits "necessary" from "differentiating".** The agent runtime is
  table-stakes (everyone has one) — it is core but not *why* you'd be chosen.
  The differentiator is **reproducibility & signed proofs** (highlighted): the
  one thing in the whole diagram nobody else integrates. Governance and evals
  reinforce it.
- **The arrow is consumption, not sequence.** The core *consumes* Tier 2 via
  ports — it doesn't run "before" them.
- **Two different "identities", deliberately on different tiers.** **Agent
  identity** (signed, replay-protected) lives in Tier 1 governance — it's yours.
  **People auth / SSO** (human login) is a thin Tier 2 port — delegate it to
  Auth0/Entra/WorkOS. They are not the same thing.
- **Guardrails are "governed", not absolute.** Detection is measured by
  `benchmarks/guardrail-detection.ts` (internal adversarial set): 100% recall
  across 6 evasion categories, 0% false positives on benign near-misses that
  *legitimately discuss* injection/jailbreak. This measures coverage against
  **known** evasions, not robustness to novel attacks — the roadmap is validating
  against an external corpus. Re-run it rather than trusting an adjective.
