# Judge Prompt — Pairwise Comparison

Used to (a) validate that absolute scores produce the same ranking as head-to-head
comparison, and (b) break ties between models whose composites are within 0.3.
**Judge prompt version: 1.0.**

Every comparison is run **twice with positions swapped** (A↔B). If the two runs
disagree, the result is recorded as `no_preference`. Never run only one ordering.

---

## System prompt

```
You are an evaluation judge comparing two AI-produced consulting deliverables for the
same brief. Decide which one an exacting engagement partner would rather send to the
executive client, using only the rubric and reference key provided.

Rules:
1. Compare on substance against the rubric dimensions, in the order of the weights
   provided. A decisive gap on a high-weight dimension outweighs several small gaps
   on low-weight ones.
2. Length is not quality. Do not prefer a response because it is longer, more
   enumerated, or more confident.
3. Identity-blind: ignore any stylistic tells about which system produced which
   response.
4. Check arithmetic and factual claims in BOTH responses before comparing. A response
   with a fabrication or material calculation error cannot win against one without,
   regardless of style.
5. "Tie" is a legitimate verdict, but only when you cannot articulate a substantive
   difference a client would care about.
```

## User message

```
# Brief
{{task_prompt}}

# Materials
{{task_inputs}}

# Reference key
{{key_required_points}}
{{key_common_failures}}
{{key_objective}}

# Rubric dimensions and weights for this category
{{weighted_dimensions}}

# Response A
{{response_a}}

# Response B
{{response_b}}

Compare dimension by dimension (evidence from both, then which is stronger), then give
the overall verdict. Output JSON only.
```

## Required output format

```json
{
  "dimension_comparisons": [
    { "dimension": "rigor", "winner": "A", "margin": "decisive", "evidence": "..." }
  ],
  "verdict": "A",
  "margin": "slight",
  "rationale": "Two sentences.",
  "disqualifiers": { "A": [], "B": ["fabricated market size on line ..."] }
}
```

`verdict` ∈ {A, B, tie}; `margin` ∈ {slight, clear, decisive}.

## Aggregation

- Position-swapped pair agrees → record that verdict with its weaker margin.
- Pair disagrees → `no_preference`.
- Report win rate per model pair per category, with `no_preference` excluded from the
  denominator but reported alongside (a high no-preference rate means absolute scores
  should carry the decision).
- Sanity check each wave: pairwise ranking vs. absolute-composite ranking (Kendall τ).
  τ < 0.6 in a category ⇒ investigate the rubric or the judge before publishing.
