# Human Review Protocol

Humans serve three functions: **calibrate** the LLM judge, **catch** what it misses,
and **teach** the rubric (every disagreement is a potential rubric improvement). Human
time is the scarcest resource in the loop — this protocol spends it where it changes
conclusions.

## Who reviews

Reviewers must be able to assess consulting work product at partner level (you, plus
any trusted peers you recruit). Each reviewer completes the calibration set (below)
before their scores count.

## Sampling plan

| Wave | Human coverage |
|---|---|
| Wave 1 (framework bring-up) | 100% of responses |
| Steady state | 20% stratified random sample **plus** all auto-flagged responses |

Stratification: sample evenly across (category × model), so no model's score rests on
zero human eyes in any category.

**Auto-flags (always human-reviewed):**
- Judge `confidence: low`
- Any gate triggered (integrity/completion caps)
- Judge composite in the top or bottom decile of the wave (extremes drive headlines)
- Pairwise position-swap disagreements on decision-relevant pairs
- Objective-key vs. rubric-score divergence (category C, I, and K canaries)
- Any response scored on a **human-primary dimension** (see below)

## Human-primary dimensions (artifact categories K, L, M)

`robustness` and `visual_design` (listed in `rubrics/weights.yml →
human_primary_dimensions`) are judgments LLMs have not yet earned our trust on:
model architecture and visual/information design are exactly where fluent-but-wrong
is most likely. Rules:

1. **100% human review** for every response in categories K, L, M (the runner flags
   them automatically) — the 20% sampling rate does not apply.
2. The judge still scores these dimensions every time (we need the paired data),
   but the **human score is the score**; the scorecard marks judge values on these
   dimensions as *provisional*.
3. **Graduation:** a human-primary dimension is promoted to normal judge-scored
   status after judge–human Spearman ≥ 0.7 **and** within-1 ≥ 90% on that dimension
   for **two consecutive waves** with n ≥ 10 each. Demote again if either bar is
   missed in any later wave.
4. For `visual_design`, humans review the **rendered slides** (same images the
   vision judge saw, stored in `results/<wave>/artifacts/`), never the raw HTML.
5. For `robustness` on models (K), the reviewer spot-rebuilds at least the EBITDA
   line from the spec: if the spec can't be implemented as written, robustness ≤ 2
   regardless of how clean it looks.

## Blinding

- Reviewers see the task, materials, key, rubric, and the response/trace — **not** the
  model name and **not** the LLM judge's scores. Score first, then reveal judge scores
  for the reconciliation step.

## Calibration set

- 12 frozen responses (mix of categories, known-good and known-flawed) with blessed
  scores established by consensus of ≥ 2 reviewers.
- A new reviewer scores all 12; they're calibrated when their per-dimension Spearman
  vs. blessed scores is ≥ 0.7 and no dimension is systematically offset by ≥ 1 point.

## Agreement metrics (computed per wave by `runner.mjs report`)

- **Spearman ρ** between human and judge per dimension across the sampled set.
  Target ≥ 0.7. Below 0.6 on any dimension → that dimension's judge scores are
  marked *unvalidated* in the scorecard.
- **Exact-match / within-1 rate** per dimension (within-1 target ≥ 90%).
- **Gate agreement**: human and judge must agree on integrity-gate triggers ≥ 95% —
  fabrication detection is the one thing we can least afford to automate wrongly.

## Reconciliation & learning loop

For each disagreement ≥ 2 points on a dimension:

1. Reviewer writes one sentence: was the judge wrong, the human wrong, or the rubric
   ambiguous?
2. Tally at wave end:
   - **Rubric ambiguous** → tighten the anchor; bump rubric version for next wave.
   - **Judge systematically wrong** (same direction ≥ 3×) → fix judge prompt; bump
     judge prompt version for next wave.
   - **Human wrong** → note in calibration log; recalibrate reviewer if recurring.
3. Never rescore the closed wave — fixes apply forward. The scorecard records which
   rubric/judge versions produced it.

## Effort budget

At steady state with ~30 tasks × 4 models = 120 responses/wave, 20% sampling + flags
≈ 30–40 human reviews. At ~6 min/review (form in `review-form.md`), that's ~3–4 hours
per wave — one focused afternoon per model release. If that's over budget, cut the
sample to 15% before cutting flagged-response coverage; flags are where the value is.
