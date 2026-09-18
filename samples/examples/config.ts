import type { AgentOptions, Target } from "@tym17/aki";

const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** "qwen7b=http://127.0.0.1:8080,granite3b=http://127.0.0.1:8081" — one llama-server per model. */
const targets = (raw: string | undefined, fallback: string): Target[] =>
  raw
    ? raw.split(",").map((entry) => {
        const [label, url] = entry.split("=");
        return { label: (label ?? "").trim(), url: (url ?? fallback).trim() };
      })
    : [{ label: "default", url: fallback }];

/**
 * The only place environment variables are read.
 * Everything below is an llama.cpp knob or an aki option — add freely.
 */
export const config = {
  /**
   * Every example runs against the fake server by default, so `npm run example`
   * works with nothing installed and no model loaded.
   */
  live: true,
  url: process.env.LLAMA_URL ?? "http://127.0.0.1:8080",
  apiKey: process.env.LLAMA_API_KEY,
  temperature: num(process.env.LLAMA_TEMPERATURE, 0.3),
  max_tokens: num(process.env.LLAMA_MAX_TOKENS, 1024),
  maxSteps: num(process.env.AGENT_MAX_STEPS, 8),
  /** Set LOOSE_TOOLS=1 when the server runs without --jinja. */
  looseTools: process.env.LOOSE_TOOLS === "1",
  /** Models to benchmark against. */
  targets: targets(process.env.LLAMA_TARGETS, process.env.LLAMA_URL ?? "http://127.0.0.1:8080"),
  evalRuns: num(process.env.EVAL_RUNS, 1),
} satisfies AgentOptions;
