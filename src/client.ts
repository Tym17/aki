import type {
  CallOptions,
  ChatChunk,
  ChatCompletion,
  GenOptions,
  JsonSchema,
  Message,
  ToolCall,
} from './types.ts';

const DEFAULT_URL = 'http://127.0.0.1:8080';

export interface ClientOptions {
  /** Where llama-server lives. Default: http://127.0.0.1:8080 */
  url?: string;
  /** Only needed if the server was started with --api-key. */
  apiKey?: string;
  /** Merged into every request. Set temperature once, not at every call site. */
  defaults?: GenOptions;
  /** Swap in a custom fetch (proxy, mock, instrumentation). */
  fetch?: typeof globalThis.fetch;
}

export class LlamaError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(`${message}${body ? ` — ${body.slice(0, 300)}` : ''}`);
    this.name = 'LlamaError';
    this.status = status;
    this.body = body;
  }
}

export class LlamaClient {
  readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly defaults: GenOptions;
  private readonly http: typeof globalThis.fetch;

  constructor(options: ClientOptions = {}) {
    this.url = (options.url ?? DEFAULT_URL).replace(/\/+$/, '');
    this.headers = {
      'content-type': 'application/json',
      ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
    };
    this.defaults = { cache_prompt: true, ...options.defaults };
    this.http = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** The only place an HTTP call is made. */
  private async send(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await this.http(this.url + path, {
      ...init,
      headers: { ...this.headers, ...init.headers },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new LlamaError(`${init.method ?? 'GET'} ${path} → ${res.status}`, res.status, body);
    }
    return res;
  }

  private post(path: string, payload: unknown, signal?: AbortSignal): Promise<Response> {
    return this.send(path, { method: 'POST', body: JSON.stringify(payload), signal });
  }

  /** The only place a chat body is assembled. */
  private body(messages: Message[], options: CallOptions, stream: boolean): unknown {
    const { signal: _signal, ...rest } = options;
    return { ...this.defaults, ...rest, messages, stream };
  }

  private query(url: string, options: CallOptions): string {
    const readyOptions = { ...this.defaults, ...options };
    let ops: any = {};

    // TODO

    if (Object.keys(ops).length === 0) {
      return url;
    }

    return '?' + Object.entries(ops).map(([key, content]) => `${key}=${content}`).join('&')
  }

  async chat(messages: Message[], options: CallOptions = {}): Promise<ChatCompletion> {
    const res = await this.post(this.query('/v1/chat/completions', options), this.body(messages, options, false), options.signal);
    return (await res.json()) as ChatCompletion;
  }

  async *stream(messages: Message[], options: CallOptions = {}): AsyncGenerator<ChatChunk> {
    const res = await this.post(this.query('/v1/chat/completions', options), this.body(messages, options, true), options.signal);
    yield* sse<ChatChunk>(res);
  }

  /**
   * Constrained decoding. The server compiles the schema to a grammar, so the
   * output is shaped correctly by construction — no 'please reply in JSON' pleading.
   */
  async json<T = unknown>(messages: Message[], schema: JsonSchema, options: CallOptions = {}): Promise<T> {
    const res = await this.chat(messages, {
      ...options,
      response_format: { type: 'json_schema', json_schema: { name: 'output', schema, strict: true } },
    });
    return JSON.parse(res.choices[0]?.message.content ?? 'null') as T;
  }

  async tokenize(content: string, signal?: AbortSignal): Promise<number[]> {
    const res = await this.post('/tokenize', { content }, signal);
    return (await res.json()).tokens as number[];
  }

  /** Requires the server to be started with --embeddings. */
  async embed(input: string | string[], signal?: AbortSignal): Promise<number[][]> {
    const res = await this.post('/v1/embeddings', { input }, signal);
    const json = await res.json();
    return json.data.map((row: { embedding: number[] }) => row.embedding);
  }

  /** Model path, context size, chat template, slot count. */
  async props(signal?: AbortSignal): Promise<Record<string, any>> {
    return (await this.send('/props', { signal })).json();
  }

  async health(): Promise<boolean> {
    return this.send('/health').then(
      () => true,
      () => false,
    );
  }
}

/** Minimal SSE reader. llama.cpp sends `data: {...}` lines and an `error:` line on failure. */
export async function* sse<T>(res: Response): AsyncGenerator<T> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut: number;
      while ((cut = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut + 1);
        if (line.startsWith('error:')) throw new LlamaError('stream failed', 500, line.slice(6).trim());
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        yield JSON.parse(data) as T;
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}

/** Fold a stream of chunks back into one assistant message, tool-call fragments included. */
export async function collect(
  chunks: AsyncIterable<ChatChunk>,
  onToken?: (text: string) => void,
): Promise<Message> {
  let content = '';
  const calls = new Map<number, ToolCall>();

  for await (const chunk of chunks) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;
    if (delta.content) {
      content += delta.content;
      onToken?.(delta.content);
    }
    for (const part of delta.tool_calls ?? []) {
      const call = calls.get(part.index) ?? {
        id: '',
        type: 'function' as const,
        function: { name: '', arguments: '' },
      };
      if (part.id) call.id = part.id;
      if (part.function?.name) call.function.name = part.function.name;
      if (part.function?.arguments) call.function.arguments += part.function.arguments;
      calls.set(part.index, call);
    }
  }

  const message: Message = { role: 'assistant', content };
  if (calls.size) message.tool_calls = [...calls.values()];
  return message;
}
