// Provider adapters for the evals runner.
//
// Adapter contract — every provider exposes:
//   generate({ model, system, messages, tools, params, candidate }) →
//     { text, trace, usage: {input_tokens, output_tokens, tool_calls},
//       assistantContent, output_file_ids }
//
// `candidate` is the candidate/stage config block from the wave manifest, so
// adapters can read base_url, api_key_env, headers, etc. without new plumbing.
//
// Two adapters cover nearly every model family:
//   anthropic          — native SDK; supports server-side tools (web search/fetch,
//                        code execution), so agentic scaffolds require it for now.
//   openai-compatible  — plain /chat/completions over fetch. Covers OpenAI, Gemini
//                        (OpenAI-compat endpoint), DeepSeek, Qwen, Moonshot/Kimi,
//                        Mistral, Groq, Together, OpenRouter, and all local servers
//                        (Ollama, vLLM, LM Studio, llama.cpp). Point `base_url` at
//                        the server and name the key env var in `api_key_env`.
// Add a new adapter only when a provider speaks neither protocol.

import Anthropic from "@anthropic-ai/sdk";

let _anthropic;
export const anthropicClient = () => (_anthropic ??= new Anthropic());

export const SERVER_TOOLS = {
  web_search: { type: "web_search_20260209", name: "web_search" },
  web_fetch: { type: "web_fetch_20260209", name: "web_fetch" },
  code_execution: { type: "code_execution_20260120", name: "code_execution" },
};

// Fallback $/MTok [input, output] for known Anthropic models; any candidate or
// pipeline stage can override (or supply, for other providers / local = [0, 0])
// via `pricing: {input: X, output: Y}`.
const ANTHROPIC_PRICES = {
  "claude-fable-5": [10, 50],
  "claude-opus-4-8": [5, 25],
  "claude-opus-4-7": [5, 25],
  "claude-opus-4-6": [5, 25],
  "claude-sonnet-4-6": [3, 15],
  "claude-haiku-4-5": [1, 5],
};

export function costUsd(entity, usage) {
  const p = entity.pricing
    ? [entity.pricing.input, entity.pricing.output]
    : ANTHROPIC_PRICES[entity.model];
  if (!p || !usage) return null;
  // 6 decimals: cheap-model calls cost fractions of a cent; rounding them away
  // would corrupt accumulated pipeline costs.
  return +(((usage.input_tokens ?? 0) * p[0] + (usage.output_tokens ?? 0) * p[1]) / 1e6).toFixed(6);
}

export function addUsage(acc, u) {
  if (!u) return;
  acc.input_tokens += u.input_tokens ?? 0;
  acc.output_tokens += u.output_tokens ?? 0;
}

function collectTrace(content, trace, usage, fileIds) {
  for (const b of content ?? []) {
    if (b.type === "server_tool_use") {
      usage.tool_calls += 1;
      trace.push({ kind: "tool_use", name: b.name, input: b.input });
    } else if (b.type?.endsWith("tool_result")) {
      trace.push({
        kind: "tool_result",
        type: b.type,
        summary: JSON.stringify(b.content ?? b).slice(0, 800),
      });
      collectFileIds(b, fileIds);
    }
  }
}

// Code-execution results nest generated-file references at varying depths;
// scan recursively for any {type: "*_output", file_id} node.
function collectFileIds(node, out) {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) collectFileIds(n, out);
    return;
  }
  if (typeof node.file_id === "string" && node.type?.endsWith("output")) out.push(node.file_id);
  for (const v of Object.values(node)) collectFileIds(v, out);
}

export const providers = {
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
      const fileIds = [];
      let resp = await client.messages.create(req);
      addUsage(usage, resp.usage);
      collectTrace(resp.content, trace, usage, fileIds);
      // Server-side tools (web search/fetch, code execution) pause after their
      // iteration limit; re-send to resume.
      let continuations = 0;
      while (resp.stop_reason === "pause_turn" && continuations++ < 8) {
        req.messages = [...req.messages, { role: "assistant", content: resp.content }];
        resp = await client.messages.create(req);
        addUsage(usage, resp.usage);
        collectTrace(resp.content, trace, usage, fileIds);
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
        output_file_ids: [...new Set(fileIds)],
      };
    },
  },

  "openai-compatible": {
    async generate({ model, system, messages, tools, params = {}, candidate = {} }) {
      if (tools?.length) {
        throw new Error(
          "openai-compatible adapter has no server-side tool support yet — agentic scaffolds require provider 'anthropic'",
        );
      }
      const baseUrl = (candidate.base_url ?? "https://api.openai.com/v1").replace(/\/+$/, "");
      const apiKey = candidate.api_key_env ? process.env[candidate.api_key_env] : undefined;
      if (candidate.api_key_env && !apiKey) {
        throw new Error(`env var ${candidate.api_key_env} is not set`);
      }
      const body = {
        model,
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          ...messages.map((m) => ({
            role: m.role,
            content:
              typeof m.content === "string"
                ? m.content
                : m.content.map((b) => b.text ?? "").join("\n"),
          })),
        ],
        ...(params.max_tokens ? { max_tokens: params.max_tokens } : {}),
        ...(params.request ?? {}), // raw passthrough: temperature, reasoning_effort, max_completion_tokens, ...
      };
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          ...(candidate.headers ?? {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(params.timeout_ms ?? 600000),
      });
      if (!res.ok) {
        throw new Error(`${baseUrl} → HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
      }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content ?? "";
      return {
        text,
        trace: [],
        usage: {
          input_tokens: data.usage?.prompt_tokens ?? 0,
          output_tokens: data.usage?.completion_tokens ?? 0,
          tool_calls: 0,
        },
        assistantContent: text,
        output_file_ids: [],
      };
    },
  },
};
