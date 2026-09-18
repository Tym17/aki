# aki examples

Worked examples for [`@tym17/aki`](https://www.npmjs.com/package/@tym17/aki) —
agents, tools, streaming, structured output, retrieval, evals and benchmarking.

**Most example runs with no model and no network.** `fakeServer` is a
`llama-server` stand-in that speaks the same wire protocol, streaming included,
so this works the moment you clone it:

```bash
npm install
npm run example          # all 11
npm run example 03       # just the streaming one
```

Point the same code at a real server with `LLAMA_LIVE=1`:

```bash
cp .env.example .env
llama-server -m model.gguf -c 8192 --jinja --port 8080
LLAMA_LIVE=1 npm run example
```

`--jinja` is the flag that matters — it enables the model's real chat template,
which is what carries tool calling. Without it, set `LOOSE_TOOLS=1`.

## The examples

```
examples/
  01-chat.ts               the client alone: one call, and the tok/s it reports
  02-tool-call.ts          a typed tool and the two-step loop
  03-streaming.ts          tokens through the event channel
  04-multi-step.ts         a loop of unknown length, reacting to tool output
  05-conversation.ts       multi-turn memory and reset
  06-structured-output.ts  grammar-constrained JSON, parsed into a typed object
  07-error-recovery.ts     a crashing tool and an unknown tool, loop intact
  08-eval-basics.ts        a suite with the built-in checks
  09-eval-custom-checks.ts your own checks, plus an LLM judge
  10-bench-models.ts       two models compared on pass rate and tok/s
```

Example 10 is the one to read first if you're picking a model — it prints the
size-versus-speed trade-off as a table, with the fast 3B failing the tool case
that the slower 7B gets right.

Example 08 shows something worth internalising: it passes `create` so the agent
under test has its tools registered. Without that, the default agent has none, the
call errors, and `usesTools` still passes — a green run on a broken setup, which is
the one failure mode an eval must never have. `usesTools` measures what the model
*asked for*, not what succeeded; if you care about the latter, check the answer too.

## How the offline switch works

`LlamaClient` takes a `fetch`. That one constructor argument is the whole trick —
`examples/_shared.ts` hands every example either a fake server or a real URL, and
nothing downstream knows the difference:

```ts
export const clientFor = (fake: FakeServer): LlamaClient =>
  live ? new LlamaClient({ url: config.url, apiKey: config.apiKey })
       : new LlamaClient({ fetch: fake.fetch });
```

`fakeServer(turns, options)` answers chat completions, streaming and embeddings.
`tokensPerSecond` and `latency` shape the `timings` the bench reads, so a benchmark
demo has something to compare. Its embeddings are a crude bag-of-words hash — it
ranks correctly on distinct documents, but don't read anything into the scores.
Script the turns, or hand it a `reply` function and let it react:

```ts
const fake = fakeServer([], {
  tokensPerSecond: 95,
  reply: (messages) =>
    messages.at(-1)?.role === "tool"
      ? { content: "README.md has 128 lines." }
      : { toolCalls: [{ name: "count_lines", arguments: { path: "README.md" } }] },
});
```

## Layout

```
examples/
  config.ts    the only place environment variables are read
  _shared.ts   fake-or-live client selection, shared by every example
  index.ts     the registry — add an example, add one line
  run.ts       the runner behind `npm run example`
```

## Adding one

Write `examples/12-thing.ts` exporting a default `() => Promise<void>`, then add
one line to the `examples` object in `examples/index.ts`. Take a `FakeServer` from
`clientFor` so it keeps working offline.

## Scripts

| script | does |
| --- | --- |
| `npm run example [n]` | run one example, or all of them |
| `npm run check` | `tsc --noEmit` over `examples` |

Node runs the TypeScript directly by stripping types, so there is no build step —
which is why relative imports name real `.ts` files. On Node 24+ the
`--experimental-strip-types` flag is a harmless no-op; drop it from the script if
you only target 24.

## License

MIT
