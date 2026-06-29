# Architecture Diagrams

Visual reference for ElsiumAI's package layout, the agent runtime, and the
proposed phased guardrail pipeline.

> **Status legend**
> - Diagrams 1–3 describe the **current implementation** (as in `packages/`).
> - Diagrams 4–5 describe the **phased guardrail design**. The input-side
>   redaction stages (🟧 in diagram 5: input PII/secret redaction and tool-arg
>   secret redaction) are now implemented and opt-in via `AgentSecurityConfig`
>   (`redactInputSecrets`, `redactInputPii`, `redactToolArgSecrets`,
>   `injectionClassifier`) and `securityMiddleware({ redactInput })`. The LLM-backed
>   injection classifier ships as an injectable `injectionClassifier` hook rather
>   than a built-in model call.

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
