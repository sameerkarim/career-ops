# Consulting LLM Evals — Plan & Operating Guide

A model-agnostic evaluation framework for assessing LLMs (and agentic systems built on
them) on the workflows of a product strategy / management consultant serving executive
clients. Run it as a repeatable "wave" each time a new model ships, and accumulate
longitudinal data on which models are best for which tasks.

## Goals

1. **Release-time comparison** — when a new model launches, run the same frozen eval set
   and compare against prior waves within days, not weeks.
2. **Task-level routing decisions** — output is not one leaderboard number but a
   capability profile: "Model X is best for quantitative case work, Model Y for
   executive synthesis, Model Z is the cheapest acceptable researcher."
3. **Harness-agnostic** — every task declares a `mode` (`single_turn`, `multi_turn`,
   `agentic`) so the same task bank evaluates raw API calls, scripted conversations,
   and multi-agent/tool-using systems.
4. **Dual judging** — LLM-as-judge for scale and speed, humans for calibration and
   trust. Judge–human agreement is itself a tracked metric; when it drops, the rubric
   gets fixed before the scores get believed.

## Architecture at a glance

```
evals/
├── README.md                  ← this plan
├── categories.yml             ← category registry (single source of truth; add use cases here)
├── taxonomy.md                ← narrative companion: 13 categories (A–M) + how to add more
├── schema/
│   └── task-spec.md           ← the task YAML contract + result record schema
├── tasks/                     ← the task bank (one YAML per task, versioned)
│   ├── A-01-issue-tree.yml
│   └── ...
├── rubrics/
│   ├── core-dimensions.md     ← anchored 1–5 scales (6 core + 3 agentic + 2 artifact dims)
│   └── weights.yml            ← per-category dimension weights → composite score
├── judges/
│   ├── absolute-judge.md      ← rubric-scoring judge prompt template
│   ├── pairwise-judge.md      ← A/B comparison judge prompt template
│   └── bias-controls.md       ← mandatory mitigations (position swap, freezing, etc.)
├── human-review/
│   ├── protocol.md            ← sampling, calibration, agreement, human-primary dims
│   └── review-form.md         ← the human scoring form (mirrors judge dimensions)
├── harness/
│   ├── run-config.example.yml ← wave manifest: systems, judge, tasks, scaffolds
│   ├── runner.mjs             ← validate / run / audit / judge / report commands
│   ├── providers.mjs          ← adapters: anthropic + openai-compatible (covers
│   │                            OpenAI, Gemini, DeepSeek/Qwen/Kimi, Ollama/vLLM/local)
│   ├── orchestration.md       ← pipelines, provider hooks, cost/quality/privacy trades
│   └── audits/
│       └── xlsx_audit.py      ← pinned mechanical workbook audit (runs in sandbox)
└── results/                   ← JSONL per wave (gitignored raw, committed scorecards)
```

## The evaluation loop (one "wave")

A **wave** is one full evaluation pass, typically triggered by a model release.

1. **Pin the wave manifest.** Copy `harness/run-config.example.yml` →
   `harness/waves/wave-NNN.yml`. Pin: task bank git SHA, rubric version, judge model +
   judge prompt version, candidate models and their parameters, agentic scaffold
   definitions. Nothing in a wave may float — otherwise scores aren't comparable
   across waves.
2. **Generate.** `node evals/harness/runner.mjs run --wave wave-NNN` executes every
   (task × candidate) pair and writes raw responses + traces to
   `results/wave-NNN/responses.jsonl`.
3. **Judge.** `node evals/harness/runner.mjs judge --wave wave-NNN` scores every
   response with the absolute judge (and optionally pairwise vs. a baseline model).
   Outputs `results/wave-NNN/scores.jsonl`.
4. **Human review.** Sample per `human-review/protocol.md` (100% on the first wave,
   then ~20% + all flagged disagreements). Humans score on the same dimensions using
   `review-form.md`. Record in `results/wave-NNN/human-scores.jsonl`.
5. **Reconcile & report.** `node evals/harness/runner.mjs report --wave wave-NNN`
   computes per-category composites, judge–human agreement, and the capability profile
   table. Commit the scorecard markdown; archive the raw JSONL.
6. **Learn.** Every judge–human disagreement is a rubric bug, a judge-prompt bug, or a
   genuinely hard case. File it, fix it, bump the rubric/judge version — the fix
   applies to the *next* wave (never rescore a closed wave with a new rubric).

## Scoring model

- Every response is scored 1–5 on each rubric dimension (anchored scales in
  `rubrics/core-dimensions.md`). No half points.
- Composite per task = weighted average using the category weights in
  `rubrics/weights.yml`.
- **Gate questions** override the composite: a factual fabrication or a missed
  task-critical requirement caps the score at 2.0 regardless of polish. Consulting
  output that is confidently wrong is worse than useless.
- Tasks with objective keys (planted flaws, numeric answers) also report a hard
  accuracy number alongside the rubric score — these anchor judge calibration.

## Judging model

- **Absolute scoring** is the workhorse: judge sees task + reference key + rubric +
  response, outputs structured JSON scores with evidence quotes.
- **Pairwise** is used for close calls and for validating that absolute scores rank
  models the same way head-to-head comparison does. Always run both orderings
  (position swap); disagreement between orderings = "no preference".
- **Bias controls are mandatory**, not optional — see `judges/bias-controls.md`.
  Key ones: frozen judge per wave, position swap, evidence-before-score,
  length-neutrality instruction, judge model should not score its own family without
  a human-audited sample.

## Single-turn vs. agentic evaluation

The task bank is shared; what differs is what the judge sees:

| Mode | Candidate gets | Judge gets |
|---|---|---|
| `single_turn` | One prompt (+ inline artifacts) | Final response |
| `multi_turn` | Scripted user turns played in sequence | Full transcript |
| `agentic` | Task brief + tool access per scaffold definition | Final artifact **and** the trace (tool calls, sources) |

Agentic runs are additionally scored on the three agentic dimensions (source quality,
process efficiency, task completion) and on trace-level facts: number of tool calls,
tokens, wall-clock, cost. The same agentic task can be run against different scaffolds
(single model + tools, planner/worker pair, multi-agent crew) — the scaffold is part of
the pinned wave manifest, so you can compare *systems*, not just models.

## What "good" looks like (success criteria for the framework itself)

- Judge–human agreement: Spearman ≥ 0.7 per dimension on the calibration sample.
- Re-run stability: same model, same wave config, composite varies < 0.2 across
  repeated runs (run each task 2–3× and average if a model is high-variance).
- Discrimination: top and bottom candidate models separated by ≥ 0.5 composite on at
  least half the categories; if everything scores 4.5+, the tasks are too easy — add
  harder variants (difficulty `expert`).

## Comparing systems, not just models

Candidates in a wave are **systems**: single models (any provider via
`harness/providers.mjs` — Anthropic native, plus an `openai-compatible` adapter
covering OpenAI, Gemini, the Chinese labs, and local Ollama/vLLM servers) or
**orchestration pipelines** (`kind: pipeline` — staged workflows mixing local and
frontier models). The scorecard's *Systems comparison* table puts composite quality,
cost/run, latency, privacy tier, and composite-per-dollar side by side — the basis
for "frontier solo vs. orchestrated local mix" decisions. Design guide, pattern
library, and fairness rules: `harness/orchestration.md`.

## Roadmap (build order)

1. ✅ v0: taxonomy, rubrics, judge prompts, human protocol, seed tasks,
   runner supporting Anthropic models end-to-end.
2. ✅ v1 (partial): category registry + `validate` command (use cases are config,
   not code); artifact categories K/L/M with vision judging and human-primary
   dimensions; `openai-compatible` provider adapter; orchestration pipelines with
   per-stage cost/privacy accounting; systems-comparison scorecard.
   Remaining: 3–5 tasks per category incl. `expert`; pairwise judging wired into
   `report`.
3. ✅ v2 (partial): `artifact-builder` scaffold — real .xlsx/.docx/.pptx via
   server-side code execution with automatic file collection — plus the pinned
   mechanical workbook audit (`runner.mjs audit`, `harness/audits/xlsx_audit.py`)
   feeding trusted structure evidence to the judge. Remaining: pptx/docx audits,
   parallel/tool-using pipeline stages, router pipelines with real branching,
   per-client private task variants (keep client-derived tasks out of git or
   anonymize — treat them like `data/*` in this repo's data contract).
