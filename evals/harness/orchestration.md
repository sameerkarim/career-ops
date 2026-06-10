# Orchestration & Multi-Provider Testing

The unit of evaluation is a **system**, not a model. A wave's `candidates` list mixes
single models and orchestrated pipelines freely; everything downstream (judging,
scorecard, agreement) treats them identically, so "Fable solo" vs. "local mix with an
orchestration layer" is a first-class, apples-to-apples comparison on the same tasks,
same judge, same rubric.

## Provider hooks

Two adapters in `providers.mjs` cover nearly everything:

| Adapter | Covers | Config |
|---|---|---|
| `anthropic` | Claude family. Only adapter with server-side tools today → agentic scaffolds (research, artifact-builder) require it. | `model`; pricing built in |
| `openai-compatible` | OpenAI, Gemini (OpenAI-compat endpoint), DeepSeek, Qwen, Moonshot/Kimi, Mistral, Groq, Together, OpenRouter, **and all local servers** (Ollama, vLLM, LM Studio, llama.cpp) | `base_url`, `api_key_env`, optional `headers`, `params.request` raw passthrough (temperature, reasoning_effort, …) |

Examples (candidate or pipeline-stage blocks):

```yaml
# OpenAI
provider: openai-compatible
base_url: https://api.openai.com/v1
api_key_env: OPENAI_API_KEY
model: <model-id>
pricing: { input: 0.0, output: 0.0 }   # $/MTok — fill from provider price list
privacy: cloud-us

# Gemini via its OpenAI-compatible endpoint
base_url: https://generativelanguage.googleapis.com/v1beta/openai
api_key_env: GEMINI_API_KEY

# DeepSeek (same pattern for Qwen/DashScope, Moonshot, etc.)
base_url: https://api.deepseek.com/v1
api_key_env: DEEPSEEK_API_KEY
privacy: cloud-cn

# Local — Ollama (no key), vLLM, LM Studio, llama.cpp server
base_url: http://localhost:11434/v1
model: qwen3:32b
pricing: { input: 0, output: 0 }       # marginal token cost ~0; electricity/hw amortization optional
privacy: local
```

Conventions:
- **`pricing` is part of the candidate config** (not code) so the cost column is
  meaningful for every provider. For local models use 0 (or an amortized estimate
  if you want honest TCO comparisons).
- **`privacy` is a free-form tier label** (`local`, `cloud-us`, `cloud-eu`,
  `cloud-cn`, …). Pipelines report the union of their stages' tiers (e.g.
  `local+cloud-us`), so the scorecard shows exactly what data left the building.
- Add a native adapter only when a provider speaks neither protocol; the contract
  is one `generate()` function (see `providers.mjs` header).

## Pipelines

`kind: pipeline` candidates run sequential named **stages**; each stage has its own
provider/model/privacy and a prompt template over `{{brief}}` and any earlier stage's
output (`{{draft}}`, `{{critique}}`, …). `samples: N` fans a stage out N times
(outputs concatenated for the next stage). The final stage's output is the system's
response; per-stage usage/cost/latency land in the response record's trace.

### Pattern library

| Pattern | Stages | When it wins |
|---|---|---|
| **Draft → critique → revise** | local draft → frontier (or cheap-cloud) critique → local revise | The workhorse: keeps bulk tokens local/cheap, spends frontier tokens only on judgment. Privacy: full materials can stay local if the critique stage gets the draft only. |
| **Best-of-N + select** | cheap stage with `samples: N` → selector stage picks/merges | High-variance creative or structuring tasks |
| **Router** | cheap classifier stage decides difficulty → easy path (local) or hard path (frontier) | Mixed-difficulty workloads; the eval tells you where the routing threshold should sit |
| **Decompose → parallel workers → synthesize** | planner → N workers → synthesizer | Long research/synthesis (v2 of the pipeline executor: parallel stages) |

Worked example — the comparison you asked for (also in `run-config.example.yml`):

```yaml
candidates:
  - name: fable-solo
    provider: anthropic
    model: claude-fable-5
    params: { max_tokens: 16000, thinking: adaptive }

  - name: local-solo
    provider: openai-compatible
    base_url: http://localhost:11434/v1
    model: qwen3:32b
    pricing: { input: 0, output: 0 }
    privacy: local

  - name: local-mix # orchestration layer: local does the work, Haiku reviews
    kind: pipeline
    stages:
      - name: draft
        provider: openai-compatible
        base_url: http://localhost:11434/v1
        model: qwen3:32b
        pricing: { input: 0, output: 0 }
        privacy: local
        prompt: "{{brief}}"
      - name: critique
        provider: anthropic
        model: claude-haiku-4-5
        privacy: cloud-us
        system: "You are a demanding engagement partner reviewing a junior's draft. List the specific, material improvements needed — analytical errors first, then structure, then language. Be terse."
        prompt: "# Brief\n{{brief}}\n\n# Draft\n{{draft}}"
      - name: revise
        provider: openai-compatible
        base_url: http://localhost:11434/v1
        model: qwen3:32b
        pricing: { input: 0, output: 0 }
        privacy: local
        prompt: "Revise the draft to address every point in the critique. Output only the final deliverable.\n\n# Brief\n{{brief}}\n\n# Draft\n{{draft}}\n\n# Critique\n{{critique}}"
```

Run all three on the same wave; the scorecard's **Systems comparison** table gives
composite, cost/run, latency, privacy tier, and composite-per-dollar side by side,
and the category table shows *where* the gap lives (a local mix often holds up on
D/F-type communication tasks long before it survives C/K-type quantitative ones).

### Reading the results — the decision you're actually making

For each category: `quality_gap = composite(frontier) − composite(system)`. Then:

1. **Gap ≤ ~0.3 and no gate triggers** → the cheaper system is a candidate for that
   task type; check cost and latency to decide.
2. **Gap concentrated in specific dimensions** → orchestration fix may close it
   (e.g. rigor gap → add a frontier verification stage just for the math).
3. **Gate triggers (integrity) on the cheap system** → disqualifying regardless of
   composite; fabrication risk doesn't average out.
4. **Privacy-constrained engagements** → filter to systems whose privacy tier is
   acceptable *first*, then compare quality among the survivors. That's the real
   question for client-confidential material: not "is local as good as Fable" but
   "which all-local system is best, and is it above the quality bar at all".

## Fairness rules (these keep the comparison honest)

- **Same frozen judge for every system** in a wave — never judge a pipeline with a
  model that's a stage inside it without doubling the human sample (bias-controls §4).
- **Pipelines never see the rubric or key** — only the judge does. A critique stage
  prompt must be written from craft knowledge, not pasted rubric anchors, or you're
  training to the test.
- **Report total system cost and latency** — all stages, all samples, including the
  tokens of discarded best-of-N candidates. The trace records per-stage breakdowns.
- **Repeats ≥ 2 for pipelines** — orchestration adds variance; average it.
- **Latency caveat for local models**: wall-clock depends on your hardware; note the
  host in the wave manifest `notes` so cross-wave latency comparisons aren't bogus.

## Current limits (deliberate v1 scope)

- Pipelines support `single_turn` tasks (incl. HTML/sheet-spec artifacts).
  Multi-turn and agentic orchestration (tool-using stages, parallel workers,
  routers with real branching) are the next executor iteration — the YAML shape is
  designed to grow into it (`kind: pipeline` stays, stages gain `tools`/`parallel`).
- Server-side tools (research, code-execution artifact building) are
  anthropic-only; an `openai-compatible` tool loop is a known TODO in
  `providers.mjs`.
