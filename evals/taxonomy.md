# Task Taxonomy — Consulting Workflows

Ten categories, A–J. Each task in `tasks/` belongs to exactly one category. Categories
were chosen so that (a) they map to distinct day-to-day consulting workflows, (b) they
stress different model capabilities, and (c) each can be evaluated in at least one of
the three modes (`single_turn`, `multi_turn`, `agentic`).

| ID | Category | Core workflow | Primary capability stressed | Typical mode |
|----|----------|---------------|------------------------------|--------------|
| A | Problem framing & structuring | Turn a messy executive concern into a MECE issue tree with prioritized hypotheses | Decomposition, MECE discipline, prioritization logic | single_turn |
| B | Market & competitive analysis | Market sizing (top-down + bottom-up), competitive landscape, entry assessment | Estimation under uncertainty, assumption hygiene | single_turn, agentic |
| C | Quantitative & financial reasoning | Case math, unit economics, break-even, sensitivity, simple valuation logic | Arithmetic reliability, model setup, interpreting results | single_turn |
| D | Synthesis & executive communication | Compress messy findings into a board-ready, answer-first narrative | Pyramid principle, signal extraction, concision | single_turn |
| E | Strategic options & recommendation | Generate genuine options, evaluate trade-offs, commit to a recommendation with risks | Option breadth, trade-off rigor, decisiveness | single_turn |
| F | Organization, people & change | Org design, stakeholder management, change communication, difficult conversations | Judgment, empathy, political realism | single_turn, multi_turn |
| G | Research & due diligence | Multi-source company/market research with verifiable citations | Tool use, source triage, citation fidelity, synthesis | agentic |
| H | Data interpretation | Extract decision-relevant insight from raw tables/extracts | Reading data correctly, separating signal from noise | single_turn |
| I | Critique & red-teaming | Pressure-test a plan or analysis; find the flaws that matter | Skepticism, error detection, severity ranking | single_turn |
| J | Client advisory interaction | Live scoping/advisory conversation: clarify, push back, hold ground under pressure | Multi-turn coherence, question quality, professional spine | multi_turn |

## Difficulty levels

- `standard` — a strong senior consultant produces excellent output in 30–60 min.
- `hard` — requires non-obvious structuring or careful quantitative work; partners
  would review the junior's draft carefully.
- `expert` — deliberately under-specified, conflicting data, or traps planted; meant
  to separate frontier models from merely good ones.

Seed bank ships one `standard`/`hard` task per category. Add `expert` variants once
top models cluster above 4.3 composite in a category (ceiling effect).

## Objective anchors

Two categories carry **objective keys** in addition to rubric scoring, used to
calibrate the LLM judge:

- **C (quant):** tasks have a single correct numeric answer (± stated tolerance).
- **I (red-team):** the artifact under critique contains *planted flaws* enumerated in
  the task key; detection rate is computed mechanically (flaw mentioned or not).

If judge rubric scores and objective anchors diverge for a model (e.g., high "rigor"
score but wrong numbers), trust the anchors and fix the judge prompt.

## Mapping to capability profile

The wave report aggregates composites into a profile per model/system:

- **Structurer** = A + E + I
- **Analyst** = B + C + H
- **Communicator** = D + F + J
- **Researcher** = G (+ agentic dimensions)

These four headline numbers, plus cost and latency, are what routing decisions
("which model do I use for X?") are made from.
