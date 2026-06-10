# Task Spec Contract (tasks/*.yml) & Result Records

## Task YAML fields

```yaml
id: C-01                  # {category}-{##}, unique, stable forever
version: "1.0"            # bump when prompt/inputs/key change; old versions stay comparable only to themselves
title: short-slug
category: C               # A–J, see taxonomy.md
mode: single_turn         # single_turn | multi_turn | agentic
difficulty: standard      # standard | hard | expert
est_minutes_human: 45     # what a strong senior consultant would need

prompt: |                 # what the candidate sees (the brief)
  ...

inputs: |                 # optional: inline artifacts (tables, memos, data) shown to candidate
  ...

turns:                    # multi_turn only: scripted user turns played in order.
  - "first user message"  # (prompt is turn 0). Keep turns fixed — no adaptive scripting,
  - "pushback message"    # so transcripts are comparable across models.

agentic:                  # agentic only
  scaffold: research-agent # must exist in the wave manifest's scaffold registry
  tools: [web_search, web_fetch]
  budget: { max_tool_calls: 25, max_minutes: 20 }
  deliverable: "exact artifact + format expected"

key:                      # NEVER shown to the candidate; judge-only
  required_points:        # missing one caps the mapped dimension at 3
    - point: "..."
      dimension: rigor
  common_failures:        # exhibiting one caps the mapped dimension at 2
    - failure: "..."
      dimension: structure
  objective:              # optional mechanical key (categories C, I primarily)
    type: numeric         # numeric | planted_flaws | checklist
    answer: "4.0M"
    tolerance: "±10%"
    # planted_flaws type instead uses: flaws: ["...", "..."]
  judge_notes: |          # extra guidance for the judge, e.g. acceptable alt approaches
    ...

constraints:              # surfaced to candidate AND checked by judge (completion/communication)
  max_words: 600
  format: "memo"
```

## Response record (results/wave-NNN/responses.jsonl, one line per run)

```json
{
  "wave": "wave-001",
  "response_id": "C-01__claude-opus-4-8__r1",
  "task_id": "C-01", "task_version": "1.0",
  "model": "claude-opus-4-8",
  "system_config": { "mode": "single_turn", "scaffold": null, "params_hash": "…" },
  "response": "final artifact text",
  "transcript": null,
  "trace": null,
  "usage": { "input_tokens": 0, "output_tokens": 0, "tool_calls": 0 },
  "latency_ms": 0, "cost_usd": 0.0,
  "started_at": "ISO-8601", "error": null
}
```

## Score record (results/wave-NNN/scores.jsonl)

The judge's JSON output (see `judges/absolute-judge.md`) plus:

```json
{
  "response_id": "C-01__claude-opus-4-8__r1",
  "judge_model": "…", "judge_prompt_version": "1.0", "rubric_version": "1.0",
  "composite": 4.1, "composite_after_gates": 4.1,
  "...judge output fields...": "…"
}
```

## Authoring guidelines for new tasks

1. **Fictional but realistic.** Invent clients; ground them in plausible economics so
   `rigor` is checkable. Never include real client material in git (treat like
   `data/*` per the repo data contract — keep private variants out of the repo).
2. **Self-contained.** Everything needed to do the task is in `prompt` + `inputs`
   (except agentic research tasks, which must be checkable against the live web).
3. **Make the key adversarial.** Write `common_failures` by predicting how a mediocre
   answer goes wrong; that's what separates a useful judge from a vibes judge.
4. **One decision per task.** If the brief asks for three deliverables, judges smear.
   Split into separate tasks.
5. **Pin numbers.** Any quantitative task must have an internally consistent data set
   and a worked solution in `key.objective` / `judge_notes`.
```
