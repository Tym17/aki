/**
 * Wire types for llama.cpp's `llama-server`.
 * Only what an agent loop actually touches — the rest passes through untyped on purpose.
 */

export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface Message {
  role: Role;
  content?: string | null;
  /** Present on assistant messages when the model wants to call tools. */
  tool_calls?: ToolCall[];
  /** Required on `role: "tool"` messages — links the result back to the call. */
  tool_call_id?: string;
  name?: string;
}

export type JsonSchema = Record<string, any>;

/**
 * Request knobs. Typed where it helps, open where it matters: llama.cpp grows
 * sampler flags faster than any wrapper can track, so unknown keys are forwarded verbatim.
 */
export interface GenOptions {
  model?: string;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  max_tokens?: number;
  repeat_penalty?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  seed?: number;
  stop?: string[];
  /** Reuse the KV cache across turns. Enabled by default — it is most of the speed in an agent loop. */
  cache_prompt?: boolean;
  /** GBNF grammar, llama.cpp-specific. */
  grammar?: string;
  response_format?: {
    type: "json_object" | "json_schema";
    json_schema?: { name: string; schema: JsonSchema; strict?: boolean };
    schema?: JsonSchema;
  };
  tool_choice?: "auto" | "none" | "required";
  parallel_tool_calls?: boolean;
  [key: string]: unknown;
}

export interface CallOptions extends GenOptions {
  signal?: AbortSignal;
  tools?: unknown[];
}

/** llama.cpp returns real timings — free tokens/second telemetry. */
export interface Timings {
  prompt_n?: number;
  prompt_ms?: number;
  prompt_per_second?: number;
  predicted_n?: number;
  predicted_ms?: number;
  predicted_per_second?: number;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletion {
  id: string;
  model: string;
  created: number;
  choices: { index: number; message: Message; finish_reason: string | null }[];
  usage?: Usage;
  timings?: Timings;
}

export interface Delta {
  role?: Role;
  content?: string | null;
  tool_calls?: {
    index: number;
    id?: string;
    type?: "function";
    function?: { name?: string; arguments?: string };
  }[];
}

export interface ChatChunk {
  id: string;
  model: string;
  choices: { index: number; delta: Delta; finish_reason: string | null }[];
  timings?: Timings;
}
