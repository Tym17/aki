import type { AgentOptions } from "./agent.ts";
import type { LlamaClient } from "./client.ts";
import type { Message } from "./types.ts";

/** What one case produced. Checks read this and nothing else. */
export interface EvalResult {
  text: string;
  messages: Message[];
  /** Every tool the model called, in order. */
  tools: string[];
  steps: number;
  ms: number;
  tokens: number;
  tokensPerSecond: number;
}

/**
 * A check returns `undefined` when it passes, or a string saying why it failed.
 * That is the entire contract — every matcher below is just a function of this shape,
 * so writing your own inline is a first-class move, not an escape hatch.
 */
export type Check = (result: EvalResult) => string | undefined | Promise<string | undefined>;

export interface EvalCase {
  name: string;
  prompt: string;
  /** One check, or several — several means all must pass. */
  expect: Check | Check[];
  /** Per-case overrides: different temperature, system prompt, tool set… */
  options?: AgentOptions;
}

export interface EvalSuite {
  name: string;
  cases: EvalCase[];
  options?: AgentOptions;
}

/** Local models vary in case and whitespace; nothing interesting is ever hiding in either. */
const norm = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
const show = (value: string) => JSON.stringify(value.length > 60 ? `${value.slice(0, 60)}…` : value);

export const contains =
  (...needles: string[]): Check =>
  (result) => {
    const text = norm(result.text);
    const missing = needles.filter((needle) => !text.includes(norm(needle)));
    return missing.length ? `missing ${missing.map(show).join(", ")}` : undefined;
  };

export const absent =
  (...needles: string[]): Check =>
  (result) => {
    const text = norm(result.text);
    const found = needles.filter((needle) => text.includes(norm(needle)));
    return found.length ? `should not mention ${found.map(show).join(", ")}` : undefined;
  };

export const equals =
  (expected: string): Check =>
  (result) =>
    norm(result.text) === norm(expected) ? undefined : `expected ${show(expected)}, got ${show(result.text)}`;

export const matches =
  (pattern: RegExp): Check =>
  (result) =>
    pattern.test(result.text) ? undefined : `no match for ${pattern} in ${show(result.text)}`;

export const usesTools =
  (...names: string[]): Check =>
  (result) => {
    const missing = names.filter((name) => !result.tools.includes(name));
    return missing.length ? `never called ${missing.join(", ")}` : undefined;
  };

export const noTools =
  (): Check =>
  (result) =>
    result.tools.length ? `called ${result.tools.join(", ")}` : undefined;

export const withinSteps =
  (max: number): Check =>
  (result) =>
    result.steps <= max ? undefined : `took ${result.steps} steps, budget ${max}`;

export const faster =
  (ms: number): Check =>
  (result) =>
    result.ms <= ms ? undefined : `took ${Math.round(result.ms)} ms, budget ${ms} ms`;

/**
 * Grades free-form answers with another model.
 * Give it a big, fixed grader — judging with the model under test moves the goalposts
 * every time you swap models, which is the one thing an eval must not do.
 */
export const judge =
  (criterion: string, grader: LlamaClient): Check =>
  async (result) => {
    const verdict = await grader.json<{ pass: boolean; reason: string }>(
      [
        { role: "system", content: "You grade answers against a criterion. Be strict and terse." },
        { role: "user", content: `Criterion: ${criterion}\n\nAnswer:\n${result.text}` },
      ],
      {
        type: "object",
        properties: { pass: { type: "boolean" }, reason: { type: "string" } },
        required: ["pass", "reason"],
      },
      { temperature: 0 },
    );
    return verdict.pass ? undefined : `judge: ${verdict.reason}`;
  };

/** Runs every check and collects all failures rather than stopping at the first. */
export async function checkAll(expect: Check | Check[], result: EvalResult): Promise<string[]> {
  const checks = Array.isArray(expect) ? expect : [expect];
  const outcomes = await Promise.all(checks.map((check) => check(result)));
  return outcomes.filter((outcome): outcome is string => typeof outcome === "string");
}
