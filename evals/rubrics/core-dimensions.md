# Rubric — Core Dimensions & Anchored Scales

Every response is scored 1–5 (integers only) on each dimension that applies to its
task category (weights in `weights.yml`; weight 0 = not scored). Anchors below are
normative: judges (LLM and human) must cite which anchor the response matches and
quote evidence before assigning the score.

**Version: 1.1** — bump on any anchor change; never rescore a closed wave with a new
version. (1.1 adds the artifact dimensions `robustness` and `visual_design`.)

---

## Core dimensions (all modes)

### 1. `structure` — Problem structuring & MECE discipline

| Score | Anchor |
|---|---|
| 5 | Decomposition is MECE, prioritized, and *tailored to this client's situation* — branches reflect the actual economics/context given, not a generic framework. The structure itself reveals where the answer lies. |
| 4 | Clean, complete decomposition with at most minor overlap; prioritization present but partially justified. |
| 3 | Recognizable framework applied competently but generically (a relabeled 4P/Porter template); some overlap or a missing branch a partner would catch. |
| 2 | Significant gaps or double-counting; structure is a list, not a logic. |
| 1 | No discernible structure, or structure actively misleads (conflates causes and symptoms). |

### 2. `rigor` — Analytical & quantitative rigor

| Score | Anchor |
|---|---|
| 5 | All calculations correct; every assumption explicit, sourced or sanity-checked against a stated benchmark; sensitivity of the conclusion to key assumptions addressed. |
| 4 | Calculations correct; assumptions stated but one or two not stress-tested; conclusion follows from the analysis. |
| 3 | Approach is right; minor arithmetic slip or one unstated load-bearing assumption; conclusion still directionally supported. |
| 2 | Material calculation error, or conclusion does not follow from the analysis shown. |
| 1 | Numbers fabricated, units broken, or analysis is decorative (conclusion was reached independently of it). |

### 3. `insight` — Insight quality ("so what")

| Score | Anchor |
|---|---|
| 5 | At least one non-obvious, defensible implication a smart executive wouldn't have already had; clearly tied to a decision the client must make. |
| 4 | Correct and useful implications, clearly stated, but within reach of an informed insider. |
| 3 | Accurate restatement of what the data/brief shows; "so what" present but thin. |
| 2 | Summary without implication; insight claimed but not supported. |
| 1 | Platitudes ("focus on the customer"), or "insights" contradicted by the provided material. |

### 4. `communication` — Executive communication

| Score | Anchor |
|---|---|
| 5 | Answer-first (governing thought up top), pyramid-structured support, every sentence earns its place; correct register for a board/C-suite audience; could be forwarded to the client unedited. |
| 4 | Answer-first and well organized; minor verbosity or hedging a partner would trim. |
| 3 | Right content, wrong shape — buried lede, narrative meanders, or length is 2× what the audience would tolerate. |
| 2 | Disorganized; reader must do the synthesis themselves. |
| 1 | Stream of consciousness, heavy filler, or tone inappropriate for an executive client. |

### 5. `actionability` — Actionability of recommendations

| Score | Anchor |
|---|---|
| 5 | Recommendation is decided (not a menu), sequenced, sized where possible, with owners/first steps, explicit risks and mitigations, and a stated trigger for revisiting. |
| 4 | Clear recommendation with next steps; risks named but mitigations thin. |
| 3 | Direction is clear but stops at "what", not "how/who/when". |
| 2 | Hedged menu of options with no commitment, or actions disconnected from the analysis. |
| 1 | No actionable content, or recommendations that ignore stated constraints (budget, timeline, regulation). |

### 6. `integrity` — Factual integrity & calibration

| Score | Anchor |
|---|---|
| 5 | No fabrications; uncertainty flagged and quantified where it matters; distinguishes what is known from the brief vs. assumed vs. would-need-to-verify. |
| 4 | No fabrications; uncertainty mostly flagged, occasionally glossed. |
| 3 | No material fabrication, but overconfident tone on shaky ground; assumptions presented as facts. |
| 2 | One material unsupported factual claim presented as fact (invented market figure, invented competitor move). |
| 1 | Multiple fabrications, or fabricated citations/sources. |

> **Gate:** any response scoring 1–2 on `integrity` has its composite capped at 2.0.

---

## Agentic dimensions (mode = `agentic` only)

### 7. `sources` — Source quality & citation fidelity

| Score | Anchor |
|---|---|
| 5 | Claims traceable to cited sources; sources are primary/authoritative where available; conflicting sources surfaced and adjudicated; recency checked. |
| 4 | Solid citations on key claims; secondary sources where primary exist; no conflicts hidden. |
| 3 | Citations present but spotty; some load-bearing claims uncited. |
| 2 | Citations decorative — cited source does not support the claim attached to it. |
| 1 | Fabricated or dead citations. (Also triggers the `integrity` gate.) |

### 8. `efficiency` — Process efficiency

| Score | Anchor |
|---|---|
| 5 | Near-minimal tool path: no redundant searches, dead ends recognized and cut quickly, intermediate results reused. |
| 4 | Minor redundancy (repeated similar queries) but steady convergence. |
| 3 | Noticeable wheel-spinning or re-fetching; got there at ~2× the necessary cost. |
| 2 | Loops, repeated failures on the same action, large irrelevant detours. |
| 1 | Burned the budget without converging; trace shows no strategy. |

### 9. `completion` — Task completion & instruction adherence

| Score | Anchor |
|---|---|
| 5 | Every element of the brief delivered in the requested format/constraints (length, sections, deadline scope); nothing invented beyond scope. |
| 4 | Brief delivered; one minor format/constraint deviation. |
| 3 | Core delivered; a secondary requirement dropped or format ignored. |
| 2 | Material part of the brief missing or replaced with something not asked for. |
| 1 | Output does not address the brief. |

---

## Artifact dimensions (categories K, L, M — **human-primary**, see protocol)

Judge scores on these two dimensions are *provisional* until validated against human
review for two consecutive waves (ρ ≥ 0.7); until then the human score is the score.

### 10. `robustness` — Artifact engineering quality (models & plans)

For **financial models** (K): would this survive the partner changing an assumption
at 11pm? For **project plans** (M): would this survive one task slipping a week?

| Score | Anchor |
|---|---|
| 5 | Models: inputs / calculation logic / outputs cleanly separated; every driver is a named, single-point-of-change assumption; no magic numbers inside formulas; scenario/sensitivity built in; a stranger could audit and re-run it in minutes. Plans: dependencies and critical path explicit; long-lead items front-loaded; buffers and decision gates present; resourcing reconciled against stated constraints. |
| 4 | Sound architecture with minor lapses — one hardcoded value, one missing sensitivity; plan has dependencies but thin buffers or one unsequenced long-lead item. |
| 3 | Works for the base case only: changing an assumption means hand-editing formulas; critical path implied but never stated; resourcing asserted, not reconciled. |
| 2 | Inputs and calculations conflated; hardcoded chains; plan is a dated task list with no dependency logic. |
| 1 | Broken logic, circular references, internally inconsistent dates/resources, or outputs not derivable from the stated inputs. |

### 11. `visual_design` — Information & visual design (presentations)

Scored from the **rendered artifact** (slide images), not the markup.

| Score | Anchor |
|---|---|
| 5 | Every slide title is an assertion (the "so what", not a label); one message per slide with one supporting exhibit; chart types match the data and the message; visual hierarchy guides the eye to the point; consistent, restrained, board-appropriate design. Reading titles alone gives the full storyline. |
| 4 | Assertion titles and sensible exhibits throughout; minor clutter, inconsistency, or one chart that works but isn't the best choice. |
| 3 | Descriptive titles ("Revenue overview"); readable but generic; data shown in tables where a chart would carry the message, or vice versa. |
| 2 | Walls of text or numbers; decoration over information; misleading axes/scales; hierarchy absent. |
| 1 | Unreadable or broken layout, or exhibits that contradict the data/storyline. |

---

## Scoring rules (apply to LLM judge and humans identically)

1. Score each dimension independently; do not let one strong dimension halo the rest.
2. Evidence first: quote the passage(s) (or trace events) justifying the score, then
   assign the integer. No evidence, no score above 3.
3. When torn between two scores, assign the lower one (scale is anchored to "would a
   partner sign this", not "is this impressive for an AI").
4. Reference keys list *required points* and *common failures* — missing a required
   point caps the relevant dimension at 3; exhibiting a listed failure caps it at 2.
5. Length is not quality. A 5 on `communication` is usually the *shorter* artifact.
