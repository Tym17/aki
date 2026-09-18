import type { ChatChunk, ChatCompletion, Delta, Message, Timings, ToolCall } from "./types.ts";

/** One scripted model turn: some text, some tool calls, or both. */
export interface FakeTurn {
  content?: string;
  toolCalls?: { name: string; arguments: unknown }[];
}

export interface FakeOptions {
  /** Simulated generation speed, reported in `timings` so the bench has something to measure. */
  tokensPerSecond?: number;
  /** Milliseconds between streamed chunks, so streaming looks like streaming. */
  streamDelay?: number;
  /** Milliseconds before any response, so a benchmark has latency to report. */
  latency?: number;
  /**
   * Dynamic replies: decide the next turn from the conversation so far.
   * Returning undefined falls through to the scripted `turns`.
   */
  reply?: (messages: Message[]) => FakeTurn | undefined;
}

export interface FakeServer {
  fetch: typeof globalThis.fetch;
  /** Every messages array the server was asked to complete. */
  requests: Message[][];
}

/**
 * A llama-server stand-in. Because the client accepts a `fetch`, this is enough to
 * run the whole agent loop — tools, streaming, retrieval, evals — with no model,
 * no network and no mocking library.
 */
export function fakeServer(turns: FakeTurn[] = [], options: FakeOptions = {}): FakeServer {
  const { tokensPerSecond = 40, streamDelay = 0, latency = 0, reply } = options;
  const requests: Message[][] = [];
  let index = 0;

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (latency) await sleep(latency);

    if (String(input).includes("/v1/embeddings")) {
      const texts: string[] = Array.isArray(body.input) ? body.input : [body.input];
      return json({ data: texts.map((text) => ({ embedding: bagOfWords(text) })) });
    }

    const messages: Message[] = body.messages ?? [];
    requests.push(messages);

    const turn = reply?.(messages) ?? turns[Math.min(index++, turns.length - 1)] ?? { content: "" };
    const message = toMessage(turn);
    const timings = fakeTimings(message, tokensPerSecond);

    return body.stream ? streamed(message, timings, streamDelay) : json(complete(message, timings));
  };

  return { fetch, requests };
}

const toMessage = (turn: FakeTurn): Message => {
  const tool_calls: ToolCall[] | undefined = turn.toolCalls?.map((call, i) => ({
    id: `call_${i}`,
    type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.arguments) },
  }));
  return { role: "assistant", content: turn.content ?? "", ...(tool_calls ? { tool_calls } : {}) };
};

const fakeTimings = (message: Message, tokensPerSecond: number): Timings => {
  const text = `${message.content ?? ""}${JSON.stringify(message.tool_calls ?? "")}`;
  const predicted_n = Math.max(1, Math.round(text.length / 4)); // ≈ 4 characters per token
  return {
    prompt_n: 24,
    prompt_ms: 20,
    predicted_n,
    predicted_ms: (predicted_n / tokensPerSecond) * 1000,
    predicted_per_second: tokensPerSecond,
  };
};

const complete = (message: Message, timings: Timings): ChatCompletion => ({
  id: "fake",
  model: "fake",
  created: 0,
  choices: [{ index: 0, message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }],
  usage: {
    prompt_tokens: timings.prompt_n ?? 0,
    completion_tokens: timings.predicted_n ?? 0,
    total_tokens: (timings.prompt_n ?? 0) + (timings.predicted_n ?? 0),
  },
  timings,
});

/** Real SSE, so streaming examples and the delta accumulator are exercised for real. */
function streamed(message: Message, timings: Timings, delay: number): Response {
  const chunks: ChatChunk[] = [];
  const push = (delta: Delta, finish_reason: string | null = null) =>
    chunks.push({ id: "fake", model: "fake", choices: [{ index: 0, delta, finish_reason }] });

  push({ role: "assistant" });
  for (const piece of (message.content ?? "").match(/\S+\s*/g) ?? []) push({ content: piece });

  message.tool_calls?.forEach((call, index) => {
    // Split across chunks the way a real server does — name first, arguments after.
    push({ tool_calls: [{ index, id: call.id, type: "function", function: { name: call.function.name } }] });
    push({ tool_calls: [{ index, function: { arguments: call.function.arguments } }] });
  });

  chunks.push({
    id: "fake",
    model: "fake",
    choices: [{ index: 0, delta: {}, finish_reason: message.tool_calls ? "tool_calls" : "stop" }],
    timings,
  });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        if (delay) await sleep(delay);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/**
 * A deterministic stand-in for an embedding model: words land in fixed buckets,
 * so texts sharing vocabulary come out similar. Enough to test retrieval offline.
 */
function bagOfWords(text: string, dimensions = 64): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    let h = 0x811c9dc5;
    for (let i = 0; i < word.length; i++) {
      h ^= word.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    const bucket = (h >>> 0) % dimensions;
    vector[bucket] = (vector[bucket] ?? 0) + 1;
  }
  return vector;
}
