# Judge Bias Controls — Mandatory Rules

LLM judges have known, measurable biases. Every wave must apply all of the controls
below; the wave manifest records that they were applied. A scorecard produced without
them is not comparable to one produced with them.

## 1. Freeze the judge per wave

- Pin judge **model ID**, **prompt version**, and **rubric version** in the wave
  manifest. Within a wave, never change any of them mid-run.
- Across waves, keep the same judge as long as it's available. When the judge model
  itself must change (deprecation, clearly better judge), run a **bridge wave**: score
  one previous wave's responses with both old and new judge, publish the offset, and
  only then switch.

## 2. Position bias (pairwise)

- Always run both orderings (A/B and B/A). Disagreement → `no_preference`.
- Never present more than two responses in a single judging call.

## 3. Verbosity / style bias

- Explicit "length is not quality" instruction in both judge prompts (done).
- Monitor: per wave, compute correlation between response token count and composite
  score *within the same model*. Persistent r > 0.4 across categories suggests the
  judge is rewarding length — tighten anchors or add a length-band note to the task.

## 4. Self-preference bias

- Prefer a judge from a different model family than the candidates, **or** accept
  same-family judging but require the human-review sample for same-family candidates
  to be doubled (40% instead of 20%) until agreement is demonstrated ≥ 0.7.
- Never let a candidate model judge its own outputs from the same wave.

## 5. Reference-key leakage

- The candidate must never see the reference key; keys live only in the task YAML and
  are injected only into judge calls. The runner enforces this (separate fields).

## 6. Evidence-before-score

- Judges must quote evidence before emitting a number (enforced by output schema
  ordering). Scores with empty evidence arrays are rejected and re-judged once; twice
  → flagged for human review.

## 7. Determinism and variance

- Run the judge with thinking enabled and no sampling overrides; judge each response
  **once** by default, but for any composite within 0.2 of a decision boundary
  (model A vs model B ranking flip), re-judge 3× and take the median.
- Track judge self-consistency quarterly: re-judge a frozen set of 20 responses; if
  median absolute composite drift > 0.3, recalibrate before the next wave.

## 8. Calibration anchors

- Objective-key tasks (categories C and I) are the canary: if the judge's `rigor`
  score disagrees with the mechanical numeric/flaw-detection result on > 10% of
  responses, fix the judge prompt before trusting any other scores in the wave.
- Keep 3 frozen exemplar responses per category (a clear 2, a 3, and a 5, blessed by
  human reviewers). Run them through the judge at the start of each wave; all must
  land within ±1 of their blessed composite or the wave halts.

## 9. Contamination awareness

- Tasks are original and fictional-client by design; still, rotate surface details
  (names, numbers, industries) when publishing or when a task is suspected to be in
  training data. Record `task_version` so rotated variants are tracked.
- Never benchmark a model on tasks that were used to fine-tune or prompt-tune any
  system under test.

## 10. Human override

- Human scores, when present, supersede judge scores in the scorecard (judge scores
  retained for the agreement metric). Disagreements ≥ 2 points on any dimension are
  rubric bugs by default — file them in the wave retro.
