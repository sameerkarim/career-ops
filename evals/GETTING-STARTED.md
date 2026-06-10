# Getting Started — Running Your First Eval Wave

A practical walkthrough, no prior context needed. For the *why* behind the design,
read `README.md`; this file is the *how*.

## What you'll have at the end

A `scorecard.md` comparing the models/systems you chose on 13 consulting task
categories: quality scores per category, cost per run, latency, privacy tier, and
a judge whose reliability you've measured against your own review.

## 1. Prerequisites

- Node 20+, `npm install` run at the repo root
- `ANTHROPIC_API_KEY` exported (used by the judge, and by any Claude candidates)
- For HTML-deck rendering (task L-01): Playwright's browser —
  `npx playwright install chromium` (one-time)
- Optional, for other providers: the relevant API key env vars, or a local server
  (Ollama/vLLM/LM Studio) running

## 2. Create your wave

A **wave** is one frozen evaluation pass — typically one per model release.

```bash
mkdir -p evals/harness/waves
cp evals/harness/run-config.example.yml evals/harness/waves/wave-001.yml
```

Edit `wave-001.yml`:

- `wave:` → `wave-001`
- `candidates:` → the models/systems you want to compare. The example file has
  ready-to-uncomment blocks for OpenAI/Gemini/DeepSeek/local-Ollama models and an
  orchestrated local+cloud pipeline. Three knobs matter per candidate:
  - `pricing: {input: X, output: Y}` ($/MTok) — so the cost column is real
  - `privacy:` (`local`, `cloud-us`, `cloud-cn`, …) — so the privacy column is real
  - for pipelines: the `stages` list (see `harness/orchestration.md`)
- `tasks: all` is fine to start; or list ids like `[A-01, C-01, D-01]` for a cheap
  shakedown run.

Sanity-check it:

```bash
node evals/harness/runner.mjs validate --wave evals/harness/waves/wave-001.yml
```

## 3. Run the pipeline

```bash
# 1) Generate: every task × candidate × repeat → responses.jsonl
node evals/harness/runner.mjs run    --wave evals/harness/waves/wave-001.yml

# 2) (only if you ran K-02 / xlsx tasks) mechanical workbook audit → audits.jsonl
node evals/harness/runner.mjs audit  --wave evals/harness/waves/wave-001.yml

# 3) LLM judge scores everything → scores.jsonl
node evals/harness/runner.mjs judge  --wave evals/harness/waves/wave-001.yml

# 4) Scorecard → results/wave-001/scorecard.md (also printed)
node evals/harness/runner.mjs report --wave evals/harness/waves/wave-001.yml
```

All steps are resumable — re-running skips work already done, so a crashed or
rate-limited run just continues. Errors are recorded per response, never fatal to
the wave.

Rough cost expectation: with 14 tasks × 3 Claude candidates, generation plus
judging is typically a few dollars; the judge (Opus + cached rubric) is usually
the larger share.

## 4. Do the human review (don't skip on wave 1)

The LLM judge is only as trustworthy as you've *measured* it to be.

1. Open `results/wave-001/scorecard.md` → the **Flagged for human review** list,
   plus (on wave 1) everything else — first wave is 100% human-reviewed.
2. For each response, fill in `human-review/review-form.md` — score *before*
   looking at the judge's scores. Artifacts: review the rendered slide PNGs in
   `results/wave-001/artifacts/`, and for spreadsheets spot-rebuild the EBITDA
   line from the spec.
3. Save each as a JSON line in `results/wave-001/human-scores.jsonl` (shape is at
   the bottom of the review form).
4. Re-run `report` — it now shows judge–human agreement per dimension. ρ ≥ 0.7 →
   you can trust the judge there and drop to 20% sampling next wave; below → fix
   the rubric anchors or judge prompt (version-bump, applies next wave).

## 5. Read the scorecard

- **Systems comparison** — the headline: composite, cost/run, latency, privacy,
  composite-per-dollar. This is where "frontier solo vs. orchestrated local mix"
  gets decided.
- **Composite by category** — *where* a gap lives (cheap systems usually fall off
  on quant/C/K before communication/D/F).
- **Capability profiles** — Structurer / Analyst / Communicator / Researcher /
  Builder roll-ups for routing decisions.
- Decision rules of thumb: quality gap ≤ 0.3 with no integrity gates → cheaper
  system is viable for that task type; gap concentrated in one dimension → try an
  orchestration fix (e.g. a frontier verification stage); any integrity gate →
  disqualifying. Full framework: `harness/orchestration.md`.

## 6. Common next moves

| You want to… | Do this |
|---|---|
| Add a model (any provider) | New `candidates:` entry; non-Anthropic → `provider: openai-compatible` + `base_url` + `api_key_env`. Examples: `harness/orchestration.md` |
| Test a local model | Same, with `base_url: http://localhost:11434/v1`, `pricing: {input: 0, output: 0}`, `privacy: local` |
| Test an orchestration (e.g. local draft + frontier review) | `kind: pipeline` candidate — copy the `local-mix` example in the wave config |
| Add a task | New YAML in `tasks/` per `schema/task-spec.md`, then `validate` |
| Add a whole category/use case | `taxonomy.md` → *Adding a use case* (registry → weights → tasks → validate) |
| Compare against last wave | Waves are directly comparable while rubric/judge pins match — diff the scorecards |
| New model just dropped | Copy last wave's manifest → `wave-002.yml`, add the model, keep every pin identical, run |

## Troubleshooting

- **`error: rubric version mismatch`** — your wave pins an old rubric version;
  either update the pin (new wave) or you're accidentally re-running a closed wave
  after a rubric change (don't — see CLAUDE.md hard rule 1).
- **Judge output not parseable** — rare; the runner skips and you can re-run
  `judge` to retry just the missing ones.
- **`artifact rendering failed`** — Playwright browser missing; run
  `npx playwright install chromium`. The judge degrades to text-only scoring and
  flags the response for human review, so nothing is lost.
- **`env var X is not set`** — a candidate's `api_key_env` names a variable you
  haven't exported.
- **Local model timeouts** — raise `params.timeout_ms` on that candidate (default
  10 min); first token on big local models can be slow.
- **Costs show "—"** — add `pricing:` to that candidate (only Anthropic models
  have built-in prices).
