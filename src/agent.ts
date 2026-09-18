import { collect, LlamaClient } from "./client.ts";
import { callTool, looseToolCalls, toolSpecs, type AnyTool, type ToolContext } from "./tool.ts";
import type { CallOptions, Message, ToolCall } from "./types.ts";

export type StopReason = "stop" | "max_steps";

export type AgentEvent =
  | { type: "step"; step: number }
  | { type: "token"; text: string }
  | { type: "assistant"; message: Message }
  | { type: "tool_call"; call: ToolCall }
  | { type: "tool_result"; name: string; content: string; error?: string }
  | { type: "done"; text: string; reason: StopReason };

export interface AgentOptions extends CallOptions {
  /** Bring your own client, or just pass `url` and let the agent make one. */
  client?: LlamaClient;
  url?: string;
  apiKey?: string;
  system?: string;
  tools?: AnyTool[];
  /** Model turns before giving up. Default: 8. */
  maxSteps?: number;
  /** Stream tokens out through `onEvent`. */
  stream?: boolean;
  /** Run a turn's tool calls concurrently instead of in order. */
  parallel?: boolean;
  /** Recover tool calls from plain text when the template has no tool support. */
  looseTools?: boolean;
  onEvent?: (event: AgentEvent) => void;
}

export interface AgentResult {
  text: string;
  reason: StopReason;
  steps: number;
  messages: Message[];
}

export class Agent {
  messages: Message[] = [];
  readonly client: LlamaClient;

  private readonly options: AgentOptions;

  constructor(options: AgentOptions = {}) {
    this.options = options;
    this.client = options.client ?? new LlamaClient({ url: options.url, apiKey: options.apiKey });
    this.reset();
  }

  /** Back to just the system prompt. */
  reset(): this {
    this.messages = this.options.system ? [{ role: "system", content: this.options.system }] : [];
    return this;
  }

  async run(input?: string | Message | Message[], overrides: Partial<AgentOptions> = {}): Promise<AgentResult> {
    // Agent-only keys are peeled off here; whatever is left is sampler config
    // and goes straight to llama.cpp. One split, no duplicated option lists.
    const {
      client: _c,
      url: _u,
      apiKey: _k,
      system: _s,
      tools = [],
      maxSteps = 8,
      stream,
      parallel,
      looseTools,
      onEvent,
      signal,
      ...gen
    } = { ...this.options, ...overrides };

    if (input) this.messages.push(...toMessages(input));
    const emit = (event: AgentEvent) => onEvent?.(event);
    const request: CallOptions = {
      ...gen,
      signal,
      ...(tools.length ? { tools: toolSpecs(tools) } : {}),
    };

    for (let step = 1; step <= maxSteps; step++) {
      emit({ type: "step", step });

      const message = stream
        ? await collect(this.client.stream(this.messages, request), (text) => emit({ type: "token", text }))
        : ((await this.client.chat(this.messages, request)).choices[0]?.message ?? {
            role: "assistant",
            content: "",
          });

      const native = message.tool_calls ?? [];
      const calls = native.length ? native : looseTools ? looseToolCalls(message.content) : [];
      const loose = !native.length && calls.length > 0;

      this.messages.push(loose ? { role: "assistant", content: message.content ?? "" } : message);
      emit({ type: "assistant", message });

      if (!calls.length) {
        const text = message.content ?? "";
        emit({ type: "done", text, reason: "stop" });
        return { text, reason: "stop", steps: step, messages: this.messages };
      }

      const ctx: ToolContext = { messages: this.messages, step, signal };
      const invoke = async (call: ToolCall): Promise<Message> => {
        emit({ type: "tool_call", call });
        const outcome = await callTool(tools, call, ctx);
        emit({
          type: "tool_result",
          name: outcome.name,
          content: String(outcome.message.content ?? ""),
          error: outcome.error,
        });
        return outcome.message;
      };

      const results = parallel ? await Promise.all(calls.map(invoke)) : await inOrder(calls, invoke);
      this.messages.push(...(loose ? results.map(asUserTurn) : results));
    }

    const text = lastAssistantText(this.messages);
    emit({ type: "done", text, reason: "max_steps" });
    return { text, reason: "max_steps", steps: maxSteps, messages: this.messages };
  }
}

export const createAgent = (options?: AgentOptions) => new Agent(options);

const toMessages = (input: string | Message | Message[]): Message[] =>
  typeof input === "string" ? [{ role: "user", content: input }] : Array.isArray(input) ? input : [input];

const inOrder = async <T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = [];
  for (const item of items) out.push(await fn(item));
  return out;
};

/** Loose mode has no real tool-call ids, so results go back as a plain turn. */
const asUserTurn = (message: Message): Message => ({
  role: "user",
  content: `Result of ${message.name}:\n${message.content ?? ""}`,
});

const lastAssistantText = (messages: Message[]): string =>
  [...messages].reverse().find((m) => m.role === "assistant" && m.content)?.content ?? "";
