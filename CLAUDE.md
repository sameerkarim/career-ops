# consulting-evals — Consulting LLM Evaluation Framework

Instructions for AI agents working in this directory. Human-friendly walkthrough:
`GETTING-STARTED.md`. Design rationale: `README.md`.

## What this is

A versioned eval framework for benchmarking LLMs and orchestrated multi-model
systems on management-consulting work (13 task categories A–M: structuring, market
analysis, quant, synthesis, strategy, org/change, research, data, red-teaming,
client interaction, financial models, presentations, project plans). Runs as
repeatable "waves" per model release; scores via LLM judge calibrated by human
review.

## Map

| Path | What | Layer |
|---|---|---|
| `categories.yml` | Category registry — single source of truth for ids/profiles | config |
| `taxonomy.md` | Narrative companion + how to add categories | doc |
| `rubrics/core-dimensions.md` | Anchored 1–5 scales, 11 dimensions. **Versioned** | rubric |
| `rubrics/weights.yml` | Per-category weights, gates, human-primary dims. **Versioned** | rubric |
| `tasks/*.yml` | Task bank. Contract: `schema/task-spec.md`. **Versioned per task** | data |
| `judges/absolute-judge.md` | Judge system prompt — first fenced code block is extracted by the runner verbatim. **Versioned** | prompt |
| `judges/pairwise-judge.md`, `judges/bias-controls.md` | A/B judging + mandatory bias mitigations | prompt/doc |
| `human-review/` | Sampling protocol, calibration, review form | doc |
| `harness/runner.mjs` | CLI: `validate` / `run` / `audit` / `judge` / `report` | code |
| `harness/providers.mjs` | Adapters: `anthropic`, `openai-compatible` (+ contract for new ones) | code |
| `harness/orchestration.md` | Pipelines, provider hooks, fairness rules | doc |
| `harness/audits/xlsx_audit.py` | Pinned mechanical workbook audit — run verbatim, never paraphrased | code |
| `harness/run-config.example.yml` | Wave manifest template | config |
| `results/<wave>/` | Raw JSONL (gitignored) + committed `scorecard.md` | output |

## Hard rules

1. **Never rescore a closed wave.** Rubric/judge/task fixes apply to the *next*
   wave. Version pins in the wave manifest are what make scores comparable.
2. **Bump versions on change**: `rubrics/core-dimensions.md` + `weights.yml` move
   together (`version:` field ↔ header line); judge prompt version is declared in
   `judges/absolute-judge.md`; tasks carry their own `version`.
3. **Task keys are judge-only.** Nothing under `key:` may ever reach a candidate
   prompt or a pipeline stage prompt. The runner enforces this; don't route around
   it when editing.
4. **Run `node harness/runner.mjs validate` after editing** any task, weights,
   categories, or wave manifest. CI-grade check; exits non-zero on problems.
5. **Human-primary dimensions** (`robustness`, `visual_design` — see
   `weights.yml → human_primary_dimensions`): judge scores are provisional; never
   remove the auto-flagging, and never "graduate" a dimension yourself — that
   requires two waves of demonstrated agreement (human-review/protocol.md).
6. **New scoring dimensions need anchors first** in `core-dimensions.md` (1–5,
   quote-the-anchor style), then weights, then tasks. Never weight an un-anchored
   dimension.
7. **Pipelines must not see the rubric** — critique/revise stage prompts are written
   from craft knowledge. Pasting rubric anchors into a stage prompt is training to
   the test (orchestration.md → fairness rules).
8. **Client material stays out of git.** Tasks are fictional by design. Real
   engagement variants live outside the repo or are fully anonymized (this
   repo holds no client data, ever).
9. **judge prompt extraction**: the runner regex-extracts the first fenced block
   after `## System prompt` in `judges/absolute-judge.md`. Keep that structure
   intact when editing the file.

## Common requests → what to do

- "Add a category / use case" → follow `taxonomy.md` → *Adding a use case*
  (registry → weights → tasks → validate). Config change only; no runner edits.
- "Add a model" → new entry in the wave manifest `candidates`. Non-Anthropic /
  local: `provider: openai-compatible` + `base_url` + `api_key_env` + `pricing` +
  `privacy`. See `harness/orchestration.md` for per-provider examples.
- "Add an orchestration/pipeline" → `kind: pipeline` candidate with templated
  stages. Patterns and the worked local-mix example: `harness/orchestration.md`.
- "Add a provider adapter" → only if it speaks neither the Anthropic nor the
  OpenAI protocol. Implement the `generate()` contract documented at the top of
  `harness/providers.mjs`.
- "Write a new task" → contract + authoring guidelines in `schema/task-spec.md`.
  Make keys adversarial (predict how mediocre answers fail); add objective anchors
  (numeric keys / planted flaws) whenever the category permits.
- "Run a wave" → see `GETTING-STARTED.md`; sequence is
  validate → run → audit (xlsx only) → judge → human review → report.

## Conventions

- Node ESM (`.mjs`), `js-yaml`, 2-space YAML; same style as the repo root scripts.
- Judge calls: Anthropic SDK, adaptive thinking, structured output
  (`output_config.format` json_schema), rubric cached via `cache_control`.
- Results are JSONL, append-only, resumable (runner skips already-done
  `response_id`s). Raw JSONL gitignored; `scorecard.md` committed.
- npm scripts: `npm run validate` / `npm run run|judge|report -- --wave <file>`.
