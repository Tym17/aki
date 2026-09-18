import type { JsonSchema, Message, ToolCall } from "./types.ts";

/** Handed to every tool so it can see the conversation and honour cancellation. */
export interface ToolContext {
  messages: Message[];
  step: number;
  signal?: AbortSignal;
}

export interface Tool<A = any, R = unknown> {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute(args: A, ctx: ToolContext): R | Promise<R>;
}

export type AnyTool = Tool<any, any>;

/* ------------------------------------------------------------------ *
 * One schema, two jobs: it constrains the model AND types the handler.
 * ------------------------------------------------------------------ */

type Simplify<T> = { [K in keyof T]: T[K] } & {};
type Required_<S> = S extends { required: readonly (infer R)[] } ? (R extends string ? R : never) : never;
type Object_<P, R extends string> = Simplify<
  { [K in Extract<keyof P, R>]: Infer<P[K]> } & { [K in Exclude<keyof P, R>]?: Infer<P[K]> }
>;

/** Derives a TypeScript type from a JSON Schema literal. */
export type Infer<S> = S extends { enum: readonly (infer E)[] }
  ? E
  : S extends { const: infer C }
    ? C
    : S extends { type: "string" }
      ? string
      : S extends { type: "number" | "integer" }
        ? number
        : S extends { type: "boolean" }
          ? boolean
          : S extends { type: "null" }
            ? null
            : S extends { type: "array"; items: infer I }
              ? Infer<I>[]
              : S extends { type: "object"; properties: infer P }
                ? Object_<P, Required_<S>>
                : unknown;

/**
 * Declares a tool. Identity at runtime; at compile time it pins `parameters`
 * as a literal so `execute` gets real argument types with no `as const` and no zod.
 */
export function tool<const S extends JsonSchema, R>(definition: {
  name: string;
  description: string;
  parameters: S;
  execute: (args: Infer<S>, ctx: ToolContext) => R | Promise<R>;
}): Tool<Infer<S>, R> {
  return definition;
}

/** Tools → the `tools` array the server expects. */
export const toolSpecs = (tools: AnyTool[]) =>
  tools.map(({ name, description, parameters }) => ({
    type: "function" as const,
    function: { name, description, parameters },
  }));

export interface ToolOutcome {
  message: Message;
  name: string;
  result?: unknown;
  error?: string;
}

/**
 * Runs one call. Never throws: a missing tool, bad JSON or a handler crash all
 * come back as readable text, which is exactly what lets the model correct itself.
 */
export async function callTool(tools: AnyTool[], call: ToolCall, ctx: ToolContext): Promise<ToolOutcome> {
  const name = call.function?.name ?? "";
  const reply = (content: string, extra: Partial<ToolOutcome> = {}): ToolOutcome => ({
    message: { role: "tool", tool_call_id: call.id, name, content },
    name,
    ...extra,
  });

  const found = tools.find((t) => t.name === name);
  if (!found) {
    return reply(`Error: no tool named "${name}". Available: ${tools.map((t) => t.name).join(", ") || "none"}`, {
      error: "unknown_tool",
    });
  }

  let args: unknown;
  try {
    args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
  } catch {
    return reply(`Error: arguments were not valid JSON: ${call.function.arguments}`, { error: "bad_arguments" });
  }

  try {
    const result = await found.execute(args, ctx);
    return reply(typeof result === "string" ? result : JSON.stringify(result ?? null), { result });
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    return reply(`Error: ${error}`, { error });
  }
}

const FENCED = /```(?:json)?\s*([\s\S]*?)```/g;

/**
 * Escape hatch for models whose chat template has no tool support (server without
 * --jinja, or a GGUF with a bare template): pulls calls out of plain text.
 */
export function looseToolCalls(content: string | null | undefined): ToolCall[] {
  if (!content) return [];
  const blocks = [...content.matchAll(FENCED)].map((m) => m[1]!);
  const open = content.indexOf("{");
  if (!blocks.length && open >= 0) blocks.push(content.slice(open, content.lastIndexOf("}") + 1));

  const calls: ToolCall[] = [];
  for (const block of blocks) {
    let parsed: any;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
      const name = item?.name ?? item?.tool ?? item?.function?.name;
      if (typeof name !== "string") continue;
      const args = item.arguments ?? item.parameters ?? item.function?.arguments ?? {};
      calls.push({
        id: `loose_${calls.length}`,
        type: "function",
        function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
      });
    }
  }
  return calls;
}
