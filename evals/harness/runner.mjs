#!/usr/bin/env node
// Consulting LLM evals runner.
//
//   node evals/harness/runner.mjs validate [--wave <wave.yml>]
//   node evals/harness/runner.mjs run    --wave evals/harness/waves/wave-001.yml
//   node evals/harness/runner.mjs audit  --wave evals/harness/waves/wave-001.yml
//   node evals/harness/runner.mjs judge  --wave evals/harness/waves/wave-001.yml
//   node evals/harness/runner.mjs report --wave evals/harness/waves/wave-001.yml
//
// validate → checks tasks/categories/weights/wave consistency (run after authoring)
// run      → results/<wave>/responses.jsonl  (one line per task × candidate × repeat)
// audit    → results/<wave>/audits.jsonl     (mechanical xlsx structure audits)
// judge    → results/<wave>/scores.jsonl     (absolute-judge scores + composites)
// report   → results/<wave>/scorecard.md     (categories, profiles, systems, agreement)
//
// Candidates come in two kinds (see harness/orchestration.md):
//   kind: model    — one provider/model (default)
//   kind: pipeline — orchestrated stages, each its own provider/model/privacy
//
// Requires ANTHROPIC_API_KEY for the anthropic provider and the judge. Other
// providers: see harness/providers.mjs.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { toFile } from "@anthropic-ai/sdk";
import {
  providers,
  anthropicClient,
  SERVER_TOOLS,
  costUsd,
  addUsage,
} from "./providers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const EVALS = path.join(ROOT, "evals");

// ------------------------------------------------------------------- config

function loadRegistry() {
  return yaml.load(fs.readFileSync(path.join(EVALS, "categories.yml"), "utf8"));
}

function loadTasks(taskDir) {
  return fs
    .readdirSync(taskDir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((f) => ({
      ...yaml.load(fs.readFileSync(path.join(taskDir, f), "utf8")),
      _file: f,
    }));
}

function loadWave(wavePath) {
  const wave = yaml.load(fs.readFileSync(wavePath, "utf8"));
  const taskDir = path.join(ROOT, wave.pins.task_dir);
  let tasks = loadTasks(taskDir);
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
  const registry = loadRegistry();
  const outDir = path.join(ROOT, wave.output_dir ?? "evals/results", wave.wave);
  fs.mkdirSync(outDir, { recursive: true });
  return { wave, tasks, weights, registry, outDir, wavePath };
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

// ----------------------------------------------------------------- validate

function cmdValidate({ wavePath } = {}) {
  const registry = loadRegistry();
  const weights = yaml.load(
    fs.readFileSync(path.join(EVALS, "rubrics", "weights.yml"), "utf8"),
  );
  const rubricDoc = fs.readFileSync(
    path.join(EVALS, "rubrics", "core-dimensions.md"),
    "utf8",
  );
  let errors = 0;
  const err = (m) => (console.error(`  ✗ ${m}`), errors++);

  // registry ↔ weights ↔ rubric anchors
  for (const cat of Object.keys(registry.categories)) {
    if (!weights.categories[cat]) err(`category ${cat} has no weights in weights.yml`);
  }
  for (const [cat, dims] of Object.entries(weights.categories)) {
    if (!registry.categories[cat]) err(`weights for ${cat} but not in categories.yml`);
    const sum = Object.values(dims).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 0.001) err(`weights for ${cat} sum to ${sum.toFixed(3)}`);
    for (const d of Object.keys(dims)) {
      if (!rubricDoc.includes("`" + d + "`")) err(`dimension "${d}" (${cat}) has no rubric anchors`);
    }
  }

  // tasks
  const tasks = loadTasks(path.join(EVALS, "tasks"));
  const ids = new Set();
  for (const t of tasks) {
    const where = `${t._file} (${t.id ?? "?"})`;
    for (const f of ["id", "version", "category", "mode", "difficulty", "prompt", "key"])
      if (!t[f]) err(`${where}: missing "${f}"`);
    if (ids.has(t.id)) err(`${where}: duplicate id`);
    ids.add(t.id);
    if (t.category && !registry.categories[t.category]) err(`${where}: unknown category "${t.category}"`);
    if (!["single_turn", "multi_turn", "agentic"].includes(t.mode)) err(`${where}: bad mode`);
    if (t.mode === "agentic" && !t.agentic?.scaffold) err(`${where}: agentic without scaffold`);
    if (t.mode === "multi_turn" && !t.turns?.length) err(`${where}: multi_turn without turns`);
    for (const p of t.key?.required_points ?? [])
      if (p.dimension && !rubricDoc.includes("`" + p.dimension + "`")) err(`${where}: key dimension "${p.dimension}" unknown`);
  }

  // wave (optional)
  if (wavePath) {
    const wave = yaml.load(fs.readFileSync(wavePath, "utf8"));
    if (wave.pins.rubric_version !== weights.version)
      err(`wave pins rubric ${wave.pins.rubric_version}, weights.yml is ${weights.version}`);
    for (const c of wave.candidates ?? []) {
      const kind = c.kind ?? "model";
      if (kind === "model" && !providers[c.provider]) err(`candidate ${c.name}: no adapter "${c.provider}"`);
      if (kind === "pipeline") {
        if (!c.stages?.length) err(`candidate ${c.name}: pipeline without stages`);
        for (const s of c.stages ?? []) {
          if (!s.name) err(`candidate ${c.name}: stage missing name`);
          if (!providers[s.provider]) err(`candidate ${c.name}/${s.name}: no adapter "${s.provider}"`);
        }
      }
    }
    const scaffolds = wave.scaffolds ?? {};
    for (const t of tasks.filter((t) => t.mode === "agentic")) {
      if (wave.tasks !== "all" && !wave.tasks.includes(t.id)) continue;
      if (!scaffolds[t.agentic.scaffold]) err(`task ${t.id}: scaffold "${t.agentic.scaffold}" not in wave manifest`);
    }
  }

  console.log(
    errors
      ? `validate: ${errors} error(s) across ${tasks.length} tasks`
      : `validate: ok — ${tasks.length} tasks, ${Object.keys(registry.categories).length} categories, weights v${weights.version}${wavePath ? ", wave manifest ok" : ""}`,
  );
  if (errors) process.exit(1);
}

// ---------------------------------------------------------------------- run

async function cmdRun(ctx) {
  const { wave, tasks, outDir } = ctx;
  const outFile = path.join(outDir, "responses.jsonl");
  const done = new Set(readJsonl(outFile).map((r) => r.response_id)); // resumable
  const sha = gitSha();
  const repeats = wave.repeats ?? 1;

  for (const cand of wave.candidates) {
    const kind = cand.kind ?? "model";
    if (kind === "model" && !providers[cand.provider]) fail(`no adapter for provider "${cand.provider}"`);
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
          model: cand.name, // system name — what scores/reports group by
          base_model: kind === "model" ? cand.model : null,
          system_kind: kind,
          privacy: systemPrivacy(cand),
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
          const result =
            kind === "pipeline"
              ? await runPipeline(cand, task)
              : await runModelTask(providers[cand.provider], cand, task, wave);
          Object.assign(record, result);
          record.cost_usd =
            record.pipeline_cost ?? costUsd(cand, record.usage);
          delete record.pipeline_cost;
          saveHtmlArtifact(record, task, outDir);
          await persistGeneratedFiles(record, task, outDir);
          record.latency_ms = Date.now() - started;
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

function systemPrivacy(cand) {
  if ((cand.kind ?? "model") === "model") return cand.privacy ?? "cloud";
  const tiers = [...new Set((cand.stages ?? []).map((s) => s.privacy ?? "cloud"))];
  return tiers.join("+");
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

async function runModelTask(provider, cand, task, wave) {
  const brief = candidateBrief(task);

  if (task.mode === "single_turn") {
    const out = await provider.generate({
      model: cand.model,
      messages: [{ role: "user", content: brief }],
      params: cand.params,
      candidate: cand,
    });
    return {
      response: out.text,
      transcript: null,
      trace: null,
      usage: out.usage,
      output_file_ids: out.output_file_ids,
    };
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
        candidate: cand,
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
      candidate: cand,
    });
    return {
      response: out.text,
      transcript: null,
      trace: out.trace,
      usage: out.usage,
      output_file_ids: out.output_file_ids,
    };
  }

  fail(`unknown mode "${task.mode}"`);
}

// ---------------------------------------------------------------- pipelines

// Orchestration pipelines: sequential named stages; each stage's prompt is a
// template over {{brief}} and {{<earlier_stage_name>}}; `samples: N` fans a stage
// out N times (outputs concatenated for the next stage — best-of-N pattern).
// The last stage's output is the system's response. See harness/orchestration.md.
function renderTemplate(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (vars[k] == null) fail(`pipeline template references unknown variable {{${k}}}`);
    return vars[k];
  });
}

async function runPipeline(cand, task) {
  if (task.mode !== "single_turn") {
    fail(`pipeline candidates support single_turn tasks only (${task.id} is ${task.mode})`);
  }
  const vars = { brief: candidateBrief(task) };
  const usage = { input_tokens: 0, output_tokens: 0, tool_calls: 0 };
  const stageRecords = [];
  let cost = 0;
  let lastText = "";
  for (const stage of cand.stages) {
    const provider = providers[stage.provider];
    if (!provider) fail(`no adapter for provider "${stage.provider}" (stage ${stage.name})`);
    const prompt = renderTemplate(stage.prompt ?? "{{brief}}", vars);
    const n = stage.samples ?? 1;
    const texts = [];
    for (let i = 0; i < n; i++) {
      const t0 = Date.now();
      const out = await provider.generate({
        model: stage.model,
        system: stage.system,
        messages: [{ role: "user", content: prompt }],
        params: stage.params,
        candidate: stage,
      });
      texts.push(out.text);
      addUsage(usage, out.usage);
      cost += costUsd(stage, out.usage) ?? 0;
      stageRecords.push({
        stage: stage.name,
        sample: n > 1 ? i + 1 : undefined,
        provider: stage.provider,
        model: stage.model,
        privacy: stage.privacy ?? "cloud",
        usage: out.usage,
        latency_ms: Date.now() - t0,
      });
    }
    lastText =
      n === 1
        ? texts[0]
        : texts.map((t, i) => `### Candidate ${i + 1}\n${t}`).join("\n\n");
    vars[stage.name] = lastText;
  }
  return {
    response: lastText,
    transcript: null,
    trace: stageRecords,
    usage,
    pipeline_cost: +cost.toFixed(4),
  };
}

// ------------------------------------------------------- artifact handling

// HTML deliverables are saved to artifacts/ at run time; the judge step renders
// them to slide screenshots so visual_design is scored from what a human sees.
function extractHtml(text) {
  const m = text.match(/```html\n([\s\S]*?)```/);
  if (m) return m[1];
  const i = text.search(/<!doctype html|<html[\s>]/i);
  return i >= 0 ? text.slice(i) : null;
}

function saveHtmlArtifact(record, task, outDir) {
  if (task.deliverable_type !== "html" || !record.response) return;
  const html = extractHtml(record.response);
  if (!html) {
    record.artifact_path = null;
    record.artifact_error = "no HTML found in response";
    return;
  }
  const dir = path.join(outDir, "artifacts");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${record.response_id}.html`);
  fs.writeFileSync(file, html);
  record.artifact_path = path.relative(ROOT, file);
}

// v2 path: agentic scaffolds with code execution produce real files (xlsx/docx/
// pptx) server-side; download them via the Files API and store under artifacts/.
async function persistGeneratedFiles(record, task, outDir) {
  if (!record.output_file_ids?.length) return;
  const client = anthropicClient();
  const dir = path.join(outDir, "artifacts");
  fs.mkdirSync(dir, { recursive: true });
  record.artifact_files = [];
  for (const fileId of record.output_file_ids) {
    try {
      const meta = await client.beta.files.retrieveMetadata(fileId);
      const resp = await client.beta.files.download(fileId);
      const name = path.basename(meta.filename ?? fileId);
      if (!name || name === "." || name === "..") continue;
      const file = path.join(dir, `${record.response_id}__${name}`);
      fs.writeFileSync(file, Buffer.from(await resp.arrayBuffer()));
      record.artifact_files.push(path.relative(ROOT, file));
    } catch (e) {
      record.artifact_error = `file ${fileId}: ${String(e?.message ?? e)}`;
    }
  }
}

async function renderArtifact(record, outDir) {
  const htmlPath = path.join(ROOT, record.artifact_path);
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto("file://" + htmlPath, { waitUntil: "networkidle" });
    const slides = await page.$$(".slide");
    const shots = [];
    if (slides.length) {
      for (const s of slides.slice(0, 8)) shots.push(await s.screenshot());
    } else {
      shots.push(await page.screenshot({ fullPage: true }));
    }
    // Persist renders for human reviewers (protocol: humans review the same images).
    const dir = path.join(outDir, "artifacts");
    shots.forEach((buf, i) =>
      fs.writeFileSync(path.join(dir, `${record.response_id}.slide${i + 1}.png`), buf),
    );
    return shots;
  } finally {
    await browser.close();
  }
}

// -------------------------------------------------------------------- audit

// Mechanical structure audit for xlsx artifacts: the pinned script in
// harness/audits/xlsx_audit.py runs inside the code-execution sandbox (openpyxl
// is pre-installed) against the uploaded workbook. The model only locates the
// file and runs the script verbatim — the checks themselves are fixed code.
async function cmdAudit(ctx) {
  const { wave, outDir } = ctx;
  const responses = readJsonl(path.join(outDir, "responses.jsonl"));
  const outFile = path.join(outDir, "audits.jsonl");
  const done = new Set(readJsonl(outFile).map((a) => a.response_id));
  const script = fs.readFileSync(
    path.join(EVALS, "harness", "audits", "xlsx_audit.py"),
    "utf8",
  );
  const client = anthropicClient();

  for (const record of responses) {
    if (done.has(record.response_id) || record.error) continue;
    const xlsx = (record.artifact_files ?? []).find((f) => f.endsWith(".xlsx"));
    if (!xlsx) continue;
    process.stdout.write(`audit ${record.response_id} ... `);
    try {
      const uploaded = await client.beta.files.upload({
        file: await toFile(fs.createReadStream(path.join(ROOT, xlsx)), path.basename(xlsx)),
      });
      const resp = await client.messages.create(
        {
          model: wave.judge.model,
          max_tokens: 8000,
          messages: [
            {
              role: "user",
              content: [
                { type: "container_upload", file_id: uploaded.id },
                {
                  type: "text",
                  text: `Locate the uploaded .xlsx file in the container, save the following script as audit.py WITHOUT modification, run "python audit.py <path-to-xlsx>", and then output ONLY the JSON the script printed — nothing else.\n\n\`\`\`python\n${script}\n\`\`\``,
                },
              ],
            },
          ],
          tools: [SERVER_TOOLS.code_execution],
        },
        { headers: { "anthropic-beta": "files-api-2025-04-14" } },
      );
      const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const m = text.match(/\{[\s\S]*\}/);
      const audit = m ? JSON.parse(m[0]) : null;
      appendJsonl(outFile, {
        response_id: record.response_id,
        artifact: xlsx,
        audit,
        error: audit ? null : "no JSON in audit output",
      });
      console.log(audit ? `ok (${audit.n_formula_cells} formulas, ${audit.n_magic_numbers} magic numbers)` : "ERROR: unparseable");
    } catch (e) {
      appendJsonl(outFile, { response_id: record.response_id, artifact: xlsx, audit: null, error: String(e?.message ?? e) });
      console.log(`ERROR: ${String(e?.message ?? e)}`);
    }
  }
  console.log(`audits → ${outFile}`);
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

function buildJudgeUserMessage(task, record, weights, audit) {
  const dims = dimensionsFor(task, weights)
    .map(([d, wt]) => `- ${d} (weight ${wt})`)
    .join("\n");
  const key = task.key ?? {};
  const fmt = (arr, f) =>
    (arr ?? []).map((x) => `- [${x.dimension}] ${x[f]}`).join("\n") || "(none)";
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
    audit
      ? `\n# Mechanical audit of the produced workbook (fixed script, trusted)\n${JSON.stringify(audit, null, 1)}`
      : "",
    `\n# Dimensions to score (anchors are in the rubric provided in your context)\n${dims}`,
    `\n# Candidate ${record.transcript ? "transcript" : "response"}\n${response}`,
    record.trace
      ? `\n# Execution trace\n${JSON.stringify(record.trace, null, 1).slice(0, 20000)}`
      : "",
    record.artifact_path
      ? `\nNOTE: rendered screenshots of the candidate's artifact are attached as images. Score visual_design from the images (what a human sees), content dimensions from both images and source.`
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
  const audits = Object.fromEntries(
    readJsonl(path.join(outDir, "audits.jsonl")).map((a) => [a.response_id, a.audit]),
  );
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

    // Render HTML artifacts to slide images for vision judging; degrade gracefully.
    let images = [];
    let renderError = null;
    if (record.artifact_path) {
      try {
        images = await renderArtifact(record, outDir);
      } catch (e) {
        renderError = String(e?.message ?? e);
      }
    }
    const userText =
      buildJudgeUserMessage(task, record, weights, audits[record.response_id]) +
      (renderError
        ? `\n\nWARNING: artifact rendering failed (${renderError}). Score content dimensions from the source; if you score visual_design from markup alone, set confidence to "low".`
        : "");
    const userContent = images.length
      ? [
          { type: "text", text: userText },
          ...images.map((buf) => ({
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: buf.toString("base64"),
            },
          })),
        ]
      : userText;

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
      messages: [{ role: "user", content: userContent }],
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
    // Human-primary dimensions (e.g. robustness, visual_design) always go to humans;
    // their judge scores are provisional until graduated (human-review/protocol.md).
    const humanPrimary = (weights.human_primary_dimensions ?? []).filter(
      (d) => scoresByDim[d] != null,
    );
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
      human_primary_dimensions: humanPrimary,
      render_error: renderError,
      flagged_for_human:
        judged.confidence === "low" ||
        comp.gates.length > 0 ||
        humanPrimary.length > 0 ||
        renderError != null,
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

function profilesFromRegistry(registry) {
  const profiles = {};
  for (const [cat, def] of Object.entries(registry.categories)) {
    (profiles[def.profile] ??= []).push(cat);
  }
  return profiles;
}

function cmdReport(ctx) {
  const { wave, outDir, weights, registry } = ctx;
  const scores = readJsonl(path.join(outDir, "scores.jsonl"));
  const human = readJsonl(path.join(outDir, "human-scores.jsonl"));
  const responses = readJsonl(path.join(outDir, "responses.jsonl"));
  if (!scores.length) fail("no scores.jsonl — run `judge` first");

  // Human scores supersede judge scores where present (bias-controls.md §11).
  const humanById = Object.fromEntries(human.map((h) => [h.response_id, h]));
  const effective = scores.map((s) => {
    const h = humanById[s.response_id];
    return h ? { ...s, scores: h.scores, source: "human" } : { ...s, source: "judge" };
  });

  const systems = [...new Set(effective.map((s) => s.model))];
  const cats = [...new Set(effective.map((s) => s.category))].sort();
  const cell = {};
  for (const s of effective) {
    (cell[`${s.model}|${s.category}`] ??= []).push(s.composite_after_gates);
  }
  const avg = (a) =>
    a?.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null;

  const hp = weights.human_primary_dimensions ?? [];
  let md = `# Scorecard — ${wave.wave}\n\nJudge: ${wave.judge.model} (prompt v${wave.pins.judge_prompt_version}, rubric v${wave.pins.rubric_version}). Human scores supersede judge scores where present.${hp.length ? ` Judge scores on human-primary dimensions (${hp.join(", ")}) are provisional pending graduation (human-review/protocol.md).` : ""}\n\n`;

  // Systems comparison: the headline table for routing and cost/quality trades.
  const respBySystem = {};
  for (const r of responses) (respBySystem[r.model] ??= []).push(r);
  md += `## Systems comparison\n\n| System | Kind | Privacy | Composite (all) | Cost/run | Latency | Composite/$ |\n|---|---|---|---|---|---|---|\n`;
  for (const m of systems) {
    const comps = effective.filter((s) => s.model === m).map((s) => s.composite_after_gates);
    const rs = respBySystem[m] ?? [];
    const costs = rs.filter((r) => r.cost_usd != null).map((r) => r.cost_usd);
    const lats = rs.filter((r) => r.latency_ms != null).map((r) => r.latency_ms);
    const kind = rs[0]?.system_kind ?? "model";
    const privacy = rs[0]?.privacy ?? "—";
    const c = avg(comps);
    const cost = costs.length ? avg(costs) : null;
    md += `| ${m} | ${kind} | ${privacy} | ${c ?? "—"} | ${cost != null ? "$" + cost : "—"} | ${lats.length ? (avg(lats) / 1000).toFixed(1) + "s" : "—"} | ${c != null && cost ? (c / cost).toFixed(1) : "—"} |\n`;
  }

  md += `\n## Composite by category\n\n| System | ${cats.join(" | ")} |\n|---|${cats.map(() => "---").join("|")}|\n`;
  for (const m of systems) {
    md += `| ${m} | ${cats.map((c) => avg(cell[`${m}|${c}`]) ?? "—").join(" | ")} |\n`;
  }

  const PROFILES = profilesFromRegistry(registry);
  md += `\n## Capability profiles\n\n| System | ${Object.keys(PROFILES).join(" | ")} |\n|---|${Object.keys(PROFILES).map(() => "---").join("|")}|\n`;
  for (const m of systems) {
    const prof = Object.values(PROFILES).map((catList) => {
      const vals = catList.flatMap((c) => cell[`${m}|${c}`] ?? []);
      return avg(vals) ?? "—";
    });
    md += `| ${m} | ${prof.join(" | ")} |\n`;
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
      md += `| ${d}${hp.includes(d) ? " (human-primary)" : ""} | ${rho} ${rho != null && rho < 0.7 ? "⚠️" : ""} | ${w1} |\n`;
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
const waveIdx = rest.indexOf("--wave");
const waveArg = waveIdx >= 0 ? rest[waveIdx + 1] : null;
const COMMANDS = ["validate", "run", "audit", "judge", "report"];
if (!cmd || !COMMANDS.includes(cmd) || (cmd !== "validate" && !waveArg)) {
  console.error("usage: runner.mjs <validate|run|audit|judge|report> --wave <wave.yml>  (validate: --wave optional)");
  process.exit(1);
}
if (cmd === "validate") {
  cmdValidate({ wavePath: waveArg ? path.resolve(waveArg) : null });
} else {
  const ctx = loadWave(path.resolve(waveArg));
  Promise.resolve(
    ({ run: cmdRun, audit: cmdAudit, judge: cmdJudge, report: cmdReport })[cmd](ctx),
  ).catch((e) => fail(e.stack ?? e));
}
