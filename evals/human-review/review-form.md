# Human Review Form

One form per response. Fill it **before** looking at the LLM judge's scores. Store as
one JSON line in `results/wave-NNN/human-scores.jsonl` (same dimension fields as judge
output, so the report tool can compute agreement directly).

---

**Wave:** ____ **Task:** ____ **Response ID:** ____ **Reviewer:** ____ **Date:** ____

## 1. Blind read

Read the brief and materials first, the response second, the reference key third.
For agentic runs, skim the trace after reading the final artifact.

## 2. Dimension scores (1–5 integers, anchors in `rubrics/core-dimensions.md`)

| Dimension | Score | Evidence (quote or trace ref) | Note |
|---|---|---|---|
| structure | | | |
| rigor | | | |
| insight | | | |
| communication | | | |
| actionability | | | |
| integrity | | | |
| sources *(agentic)* | | | |
| efficiency *(agentic)* | | | |
| completion *(agentic)* | | | |

## 3. Gate checks

- [ ] Contains a fabricated fact, figure, or citation → integrity gate
- [ ] Misses a task-critical requirement → completion gate (agentic)
- [ ] Objective key (if any): result ______ vs expected ______ → pass / fail

## 4. The two questions that matter

- **Would you send this to the client** (with at most 10 minutes of editing)?
  **yes / no** — if no, the single biggest reason: ____________________
- **Did anything here surprise you** (good or bad) that the rubric has no dimension
  for? ____________________ *(these become rubric candidates at wave retro)*

## 5. Reconciliation (after revealing judge scores)

For each dimension where |human − judge| ≥ 2:

| Dimension | Human | Judge | Verdict: judge wrong / human wrong / rubric ambiguous | One-line reason |
|---|---|---|---|---|
| | | | | |

---

### JSON record shape

```json
{
  "wave": "wave-001",
  "task_id": "C-01",
  "response_id": "C-01__claude-opus-4-8__r1",
  "reviewer": "sameer",
  "scores": { "structure": 4, "rigor": 5, "insight": 3, "communication": 4,
              "actionability": 4, "integrity": 5 },
  "gates_triggered": [],
  "objective_key": { "applicable": true, "pass": true },
  "would_ship": true,
  "ship_blocker": null,
  "rubric_gaps": null,
  "reconciliation": [
    { "dimension": "insight", "human": 3, "judge": 5,
      "verdict": "rubric_ambiguous", "reason": "anchor 4 vs 5 unclear on 'non-obvious'" }
  ]
}
```
