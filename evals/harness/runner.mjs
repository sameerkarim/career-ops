#!/usr/bin/env node
// Consulting LLM evals runner.
//
//   node evals/harness/runner.mjs run    --wave evals/harness/waves/wave-001.yml
//   node evals/harness/runner.mjs judge  --wave evals/harness/waves/wave-001.yml
//   node evals/harness/runner.mjs report --wave evals/harness/waves/wave-001.yml
//
// run    → results/<wave>/responses.jsonl   (one line per task × candidate × repeat)
// judge  → results/<wave>/scores.jsonl      (absolute-judge scores + composites)
// report → results/<wave>/scorecard.md      (per-category table, profiles, agreement)
//
// Requires ANTHROPIC_API_KEY for the anthropic provider. Other providers: add an
// adapter to `providers` below.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const EVALS = path.join(ROOT, "evals");

// $/MTok input,output — used for indicative cost in records and the scorecard.
const PRICES = {
  "claude-fable-5": [10, 50],
  "claude-opus-4-8": [5, 25],
  "claude-opus-4-7": [5, 25],
  "claude-opus-4-6": [5, 25],
  "claude-sonnet-4-6": [3, 15],
  "claude-haiku-4-5": [1, 5],
};

const SERVER_TOOLS = {
  web_search: { type: "web_search_20260209", name: "web_search" },
  web_fetch: { type: "web_fetch_20260209", name: "web_fetch" },
};

// ---------------------------------------------------------------- providers

let _anthropic;
const anthropicClient = () => (_anthropic ??= new Anthropic());

const providers = {
  anthropic: {
    async generate({ model, system, messages, tools, params = {} }) {
      const client = anthropicClient();
      const req = {
        model,
        max_tokens: params.max_tokens ?? 16000,
        messages: [...messages],
      };
      if (system) req.system = system;
      if (params.thinking === "adaptive") req.thinking = { type: "adaptive" };
      if (tools?.length) req.tools = tools;

      const usage = { input_tokens: 0, output_tokens: 0, tool_calls: 0 };
      const trace = [];
      let resp = await client.messages.create(req);
      addUsage(usage, resp.usage);
      collectTrace(resp.content, trace, usage);
      // Server-side tools (web search/fetch) pause after 10 iterations; resume.
      let continuations = 0;
      while (resp.stop_reason === "pause_turn" && continuations++ < 8) {
        req.messages = [...req.messages, { role: "assistant", content: resp.content }];
        resp = await client.messages.create(req);
        addUsage(usage, resp.usage);
        collectTrace(resp.content, trace, usage);
      }
      const text = resp.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      return {
        text,
        trace,
        usage,
        assistantContent: resp.content,
        stop_reason: resp.stop_reason,
      };
    },
  },
  // Add adapters for other model families here. Contract: generate({model, system,
  // messages:[{role,content:string}], tools, params}) → {text, trace, usage}.
};

function addUsage(acc, u) {
  if (!u) return;
  acc.input_tokens += u.input_tokens ?? 0;
  acc.output_tokens += u.output_tokens ?? 0;
}

function collectTrace(content, trace, usage) {
  for (const b of content ?? []) {
    if (b.type === "server_tool_use") {
      usage.tool_calls += 1;
      trace.push({ kind: "tool_use", name: b.name, input: b.input });
    } else if (b.type?.endsWith("tool_result")) {
      trace.push({ kind: "tool_result", type: b.type, summary: summarize(b) });
    }
  }
}

function summarize(block) {
  const s = JSON.stringify(block.content ?? block).slice(0, 800);
  return s;
}

function costUsd(model, usage) {
  const p = PRICES[model];
  if (!p) return null;
  return +((usage.input_tokens * p[0] + usage.output_tokens * p[1]) / 1e6).toFixed(4);
}

// ------------------------------------------------------------------- config

function loadWave(wavePath) {
  const wave = yaml.load(fs.readFileSync(wavePath, "utf8"));
  const taskDir = path.join(ROOT, wave.pins.task_dir);
  let tasks = fs
    .readdirSync(taskDir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((f) => yaml.load(fs.readFileSync(path.join(taskDir, f), "utf8")));
  if (wave.tasks !== "all") {
    const wanted = new Set(wave.tasks);
    tasks = tasks.filter((t) => wanted.has(t.id));
  }
  const weights = yaml.load(
    fs.readFileSync(path.join(EVALS, "rubrics", "weights.yml"), "utf8"),
  );
  if (weights.version !== wave.pins.rubric_version) {
    fail(
      `rubric version mismatch: wave pins ${wave.pins.rubric_version}, weights.yml is ${weights.version}`,
    );
  }
  const outDir = path.join(ROOT, wave.output_dir ?? "evals/results", wave.wave);
  fs.mkdirSync(outDir, { recursive: true });
  return { wave, tasks, weights, outDir, wavePath };
}

function gitSha() {
  try {
    return execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim();
  } catch {
    return null;
  }
}

const readJsonl = (f) =>
  fs.existsSync(f)
    ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
const appendJsonl = (f, obj) => fs.appendFileSync(f, JSON.stringify(obj) + "\n");

// ---------------------------------------------------------------------- run

async function cmdRun(ctx) {
  const { wave, tasks, outDir } = ctx;
  const outFile = path.join(outDir, "responses.jsonl");
  const done = new Set(readJsonl(outFile).map((r) => r.response_id)); // resumable
  const sha = gitSha();
  const repeats = wave.repeats ?? 1;

  for (const cand of wave.candidates) {
    const provider = providers[cand.provider];
    if (!provider) fail(`no adapter for provider "${cand.provider}"`);
    for (const task of tasks) {
      for (let r = 1; r <= repeats; r++) {
        const responseId = `${task.id}__${cand.name}__r${r}`;
        if (done.has(responseId)) continue;
        process.stdout.write(`run ${responseId} ... `);
        const started = Date.now();
        const record = {
          wave: wave.wave,
          response_id: responseId,
          task_id: task.id,
          task_version: task.version,
          task_sha: sha,
          model: cand.model,
          system_config: {
            mode: task.mode,
            scaffold: task.agentic?.scaffold ?? null,
            params_hash: crypto
              .createHash("sha256")
              .update(JSON.stringify(cand))
              .digest("hex")
              .slice(0, 12),
          },
          started_at: new Date(started).toISOString(),
        };
        try {
          Object.assign(record, await runTask(provider, cand, task, wave));
          record.latency_ms = Date.now() - started;
          record.cost_usd = costUsd(cand.model, record.usage);
          record.error = null;
          console.log(`ok (${record.latency_ms}ms)`);
        } catch (e) {
          record.error = String(e?.message ?? e);
          console.log(`ERROR: ${record.error}`);
        }
        appendJsonl(outFile, record);
      }
    }
  }
  console.log(`responses → ${outFile}`);
}

function candidateBrief(task) {
  let brief = task.prompt;
  if (task.inputs) brief += `\n\n---\nMATERIALS:\n${task.inputs}`;
  if (task.constraints) {
    const c = Object.entries(task.constraints)
      .map(([k, v]) => `${k}: ${v}`)
      .join("; ");
    brief += `\n\n---\nCONSTRAINTS: ${c}`;
  }
  return brief; // note: task.key is judge-only and never enters the candidate prompt
}

async function runTask(provider, cand, task, wave) {
  const brief = candidateBrief(task);

  if (task.mode === "single_turn") {
    const out = await provider.generate({
      model: cand.model,
      messages: [{ role: "user", content: brief }],
      params: cand.params,
    });
    return { response: out.text, transcript: null, trace: null, usage: out.usage };
  }

  if (task.mode === "multi_turn") {
    const messages = [{ role: "user", content: brief }];
    const transcript = [{ role: "user", content: brief }];
    const usage = { input_tokens: 0, output_tokens: 0, tool_calls: 0 };
    let last;
    for (const turn of [null, ...(task.turns ?? [])]) {
      if (turn !== null) {
        messages.push({ role: "user", content: turn });
        transcript.push({ role: "user", content: turn });
      }
      last = await provider.generate({
        model: cand.model,
        messages,
        params: cand.params,
      });
      messages.push({ role: "assistant", content: last.assistantContent ?? last.text });
      transcript.push({ role: "assistant", content: last.text });
      addUsage(usage, last.usage);
      usage.tool_calls += last.usage.tool_calls ?? 0;
    }
    return { response: last.text, transcript, trace: null, usage };
  }

  if (task.mode === "agentic") {
    const scaffold = wave.scaffolds?.[task.agentic.scaffold];
    if (!scaffold) fail(`scaffold "${task.agentic.scaffold}" not in wave manifest`);
    const tools = (task.agentic.tools ?? scaffold.tools ?? []).map((t) => {
      if (!SERVER_TOOLS[t]) fail(`unknown tool "${t}"`);
      return SERVER_TOOLS[t];
    });
    const budget = task.agentic.budget ?? {};
    const system =
      scaffold.system +
      (budget.max_tool_calls ? `\nTool-call budget: ${budget.max_tool_calls}.` : "") +
      (task.agentic.deliverable ? `\nDeliverable: ${task.agentic.deliverable}` : "");
    const out = await provider.generate({
      model: cand.model,
      system,
      messages: [{ role: "user", content: brief }],
      tools,
      params: cand.params,
    });
    return { response: out.text, transcript: null, trace: out.trace, usage: out.usage };
  }

  fail(`unknown mode "${task.mode}"`);
}

// -------------------------------------------------------------------- judge

const JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "dimension_scores",
    "objective_key_results",
    "gates_triggered",
    "top_issues",
    "summary",
    "confidence",
  ],
  properties: {
    dimension_scores: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["dimension", "evidence", "score", "justification"],
        properties: {
          dimension: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
          score: { type: "integer", enum: [1, 2, 3, 4, 5] },
          justification: { type: "string" },
        },
      },
    },
    objective_key_results: {
      type: "object",
      additionalProperties: false,
      required: ["applicable", "details", "pass_rate"],
      properties: {
        applicable: { type: "boolean" },
        details: { type: "string" },
        pass_rate: { anyOf: [{ type: "number" }, { type: "null" }] },
      },
    },
    gates_triggered: { type: "array", items: { type: "string" } },
    top_issues: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
};

// The judge system prompt is the first fenced block of judges/absolute-judge.md —
// that file is the human-readable source of truth; we extract rather than duplicate.
function judgeSystemPrompt() {
  const md = fs.readFileSync(path.join(EVALS, "judges", "absolute-judge.md"), "utf8");
  const m = md.match(/## System prompt\s*```\n([\s\S]*?)```/);
  if (!m) fail("could not extract system prompt from judges/absolute-judge.md");
  return m[1].trim();
}

function dimensionsFor(task, weights) {
  const w = { ...weights.categories[task.category] };
  if (task.mode === "agentic") Object.assign(w, weights.agentic_overlay);
  return Object.entries(w).filter(([, wt]) => wt > 0);
}

function buildJudgeUserMessage(task, record, weights) {
  const dims = dimensionsFor(task, weights)
    .map(([d, wt]) => `- ${d} (weight ${wt})`)
    .join("\n");
  const key = task.key ?? {};
  const fmt = (arr, f) => (arr ?? []).map((x) => `- [${x.dimension}] ${x[f]}`).join("\n") || "(none)";
  const response =
    record.transcript != null
      ? record.transcript.map((t) => `### ${t.role}\n${t.content}`).join("\n\n")
      : record.response;
  return [
    `# Task being evaluated`,
    `Category: ${task.category} | Mode: ${task.mode} | Difficulty: ${task.difficulty}`,
    `\n## Brief given to the candidate\n${task.prompt}`,
    task.inputs ? `\n## Materials given to the candidate\n${task.inputs}` : "",
    task.constraints ? `\n## Constraints\n${JSON.stringify(task.constraints)}` : "",
    `\n# Reference key (not shown to candidate)`,
    `## Required points (missing one caps its dimension at 3)\n${fmt(key.required_points, "point")}`,
    `## Common failures (exhibiting one caps its dimension at 2)\n${fmt(key.common_failures, "failure")}`,
    key.objective ? `## Objective key\n${yaml.dump(key.objective)}` : "",
    key.judge_notes ? `## Judge notes\n${key.judge_notes}` : "",
    `\n# Dimensions to score (anchors are in the rubric provided in your context)\n${dims}`,
    `\n# Candidate ${record.transcript ? "transcript" : "response"}\n${response}`,
    record.trace
      ? `\n# Execution trace\n${JSON.stringify(record.trace, null, 1).slice(0, 20000)}`
      : "",
    `\nEvaluate now per your instructions. Output JSON only.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function computeComposite(task, scoresByDim, weights, gatesFromJudge) {
  let num = 0;
  let den = 0;
  for (const [dim, wt] of dimensionsFor(task, weights)) {
    const s = scoresByDim[dim];
    if (s == null) continue;
    num += s * wt;
    den += wt;
  }
  const composite = den ? +(num / den).toFixed(2) : null;
  let capped = composite;
  const gates = [...(gatesFromJudge ?? [])];
  const g = weights.gates;
  if ((scoresByDim.integrity ?? 5) <= g.integrity_cap.threshold) {
    capped = Math.min(capped, g.integrity_cap.cap);
    if (!gates.includes("integrity_cap")) gates.push("integrity_cap");
  }
  if (task.mode === "agentic" && (scoresByDim.completion ?? 5) <= g.completion_cap.threshold) {
    capped = Math.min(capped, g.completion_cap.cap);
    if (!gates.includes("completion_cap")) gates.push("completion_cap");
  }
  return { composite, composite_after_gates: +capped.toFixed(2), gates };
}

async function cmdJudge(ctx) {
  const { wave, tasks, weights, outDir } = ctx;
  const responses = readJsonl(path.join(outDir, "responses.jsonl"));
  const outFile = path.join(outDir, "scores.jsonl");
  const done = new Set(readJsonl(outFile).map((s) => s.response_id));
  const taskById = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const rubric = fs.readFileSync(
    path.join(EVALS, "rubrics", "core-dimensions.md"),
    "utf8",
  );
  const sys = judgeSystemPrompt();
  const client = anthropicClient();

  for (const record of responses) {
    if (done.has(record.response_id) || record.error) continue;
    const task = taskById[record.task_id];
    if (!task) continue;
    process.stdout.write(`judge ${record.response_id} ... `);
    const resp = await client.messages.create({
      model: wave.judge.model,
      max_tokens: wave.judge.max_tokens ?? 16000,
      thinking: { type: "adaptive" },
      // Stable prefix (judge persona + full rubric) is cached across judge calls.
      system: [
        { type: "text", text: sys },
        {
          type: "text",
          text: `# Rubric (version ${wave.pins.rubric_version})\n\n${rubric}`,
          cache_control: { type: "ephemeral" },
        },
      ],
      output_config: { format: { type: "json_schema", schema: JUDGE_SCHEMA } },
      messages: [{ role: "user", content: buildJudgeUserMessage(task, record, weights) }],
    });
    const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    let judged;
    try {
      judged = JSON.parse(text);
    } catch {
      console.log("ERROR: judge output not parseable, skipping");
      continue;
    }
    const scoresByDim = Object.fromEntries(
      judged.dimension_scores.map((d) => [d.dimension, d.score]),
    );
    const comp = computeComposite(task, scoresByDim, weights, judged.gates_triggered);
    appendJsonl(outFile, {
      response_id: record.response_id,
      task_id: record.task_id,
      model: record.model,
      category: task.category,
      mode: task.mode,
      judge_model: wave.judge.model,
      judge_prompt_version: wave.pins.judge_prompt_version,
      rubric_version: wave.pins.rubric_version,
      scores: scoresByDim,
      ...comp,
      objective_key_results: judged.objective_key_results,
      top_issues: judged.top_issues,
      summary: judged.summary,
      confidence: judged.confidence,
      flagged_for_human:
        judged.confidence === "low" || comp.gates.length > 0 ? true : false,
    });
    console.log(`composite ${comp.composite_after_gates} (${judged.confidence})`);
  }
  console.log(`scores → ${outFile}`);
}

// ------------------------------------------------------------------- report

function spearman(xs, ys) {
  const rank = (a) => {
    const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const ranks = Array(a.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const r = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[idx[k][1]] = r;
      i = j + 1;
    }
    return ranks;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx && dy ? +(num / Math.sqrt(dx * dy)).toFixed(3) : null;
}

const PROFILES = {
  Structurer: ["A", "E", "I"],
  Analyst: ["B", "C", "H"],
  Communicator: ["D", "F", "J"],
  Researcher: ["G"],
};

function cmdReport(ctx) {
  const { wave, outDir } = ctx;
  const scores = readJsonl(path.join(outDir, "scores.jsonl"));
  const human = readJsonl(path.join(outDir, "human-scores.jsonl"));
  const responses = readJsonl(path.join(outDir, "responses.jsonl"));
  if (!scores.length) fail("no scores.jsonl — run `judge` first");

  // Human scores supersede judge scores where present (bias-controls.md §10).
  const humanById = Object.fromEntries(human.map((h) => [h.response_id, h]));
  const effective = scores.map((s) => {
    const h = humanById[s.response_id];
    return h ? { ...s, scores: h.scores, source: "human" } : { ...s, source: "judge" };
  });

  const models = [...new Set(effective.map((s) => s.model))];
  const cats = [...new Set(effective.map((s) => s.category))].sort();
  const cell = {};
  for (const s of effective) {
    (cell[`${s.model}|${s.category}`] ??= []).push(s.composite_after_gates);
  }
  const avg = (a) => (a?.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null);

  let md = `# Scorecard — ${wave.wave}\n\nJudge: ${wave.judge.model} (prompt v${wave.pins.judge_prompt_version}, rubric v${wave.pins.rubric_version}). Human scores supersede judge scores where present.\n\n`;
  md += `## Composite by category\n\n| Model | ${cats.join(" | ")} |\n|---|${cats.map(() => "---").join("|")}|\n`;
  for (const m of models) {
    md += `| ${m} | ${cats.map((c) => avg(cell[`${m}|${c}`]) ?? "—").join(" | ")} |\n`;
  }

  md += `\n## Capability profiles\n\n| Model | ${Object.keys(PROFILES).join(" | ")} | Cost/run (avg) |\n|---|${Object.keys(PROFILES).map(() => "---").join("|")}|---|\n`;
  for (const m of models) {
    const prof = Object.values(PROFILES).map((catList) => {
      const vals = catList.flatMap((c) => cell[`${m}|${c}`] ?? []);
      return avg(vals) ?? "—";
    });
    const costs = responses.filter((r) => r.model === m && r.cost_usd != null).map((r) => r.cost_usd);
    md += `| ${m} | ${prof.join(" | ")} | ${costs.length ? "$" + avg(costs) : "—"} |\n`;
  }

  // Judge–human agreement on the overlap.
  const overlap = scores.filter((s) => humanById[s.response_id]);
  if (overlap.length >= 5) {
    md += `\n## Judge–human agreement (n=${overlap.length})\n\n| Dimension | Spearman ρ | Within-1 |\n|---|---|---|\n`;
    const dims = [...new Set(overlap.flatMap((s) => Object.keys(s.scores)))];
    for (const d of dims) {
      const pairs = overlap
        .map((s) => [s.scores[d], humanById[s.response_id].scores?.[d]])
        .filter(([a, b]) => a != null && b != null);
      if (pairs.length < 5) continue;
      const rho = spearman(pairs.map((p) => p[0]), pairs.map((p) => p[1]));
      const w1 = +(pairs.filter(([a, b]) => Math.abs(a - b) <= 1).length / pairs.length).toFixed(2);
      md += `| ${d} | ${rho} ${rho != null && rho < 0.7 ? "⚠️" : ""} | ${w1} |\n`;
    }
  } else {
    md += `\n## Judge–human agreement\n\nInsufficient human-scored overlap (need ≥5, have ${overlap.length}). See human-review/protocol.md.\n`;
  }

  const flagged = scores.filter((s) => s.flagged_for_human && !humanById[s.response_id]);
  if (flagged.length) {
    md += `\n## ⚠️ Flagged for human review (pending)\n\n${flagged.map((s) => `- ${s.response_id} (${s.confidence}${s.gates?.length ? ", gates: " + s.gates.join(",") : ""})`).join("\n")}\n`;
  }

  const outFile = path.join(outDir, "scorecard.md");
  fs.writeFileSync(outFile, md);
  console.log(md);
  console.log(`scorecard → ${outFile}`);
}

// --------------------------------------------------------------------- main

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

const [, , cmd, ...rest] = process.argv;
const waveArg = rest[rest.indexOf("--wave") + 1];
if (!cmd || !["run", "judge", "report"].includes(cmd) || !waveArg) {
  console.error("usage: runner.mjs <run|judge|report> --wave <wave.yml>");
  process.exit(1);
}
const ctx = loadWave(path.resolve(waveArg));
Promise.resolve(({ run: cmdRun, judge: cmdJudge, report: cmdReport })[cmd](ctx)).catch((e) =>
  fail(e.stack ?? e),
);
