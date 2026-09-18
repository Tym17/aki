# Aki, tiny library for (mostly) local agents

This tiny library has been mostly created to speed up bootstrapping agents. Its focused on llama.cpp and tiny models. The goal is to have something ultra tiny and easily importable in environments requiring low dependencies. There are two aspects, the agentic side and the eval side. Use which ever part you need more alone or together, for testing one another or both working toward a goal. 

> Help your CLI get more clues about digital Jazz or something. :)

This project is mostly a week-end and hobby **work in progress** project. As such, it may not have a very stable API and may break here and there as iteration speed is prioritized. 

Any contributions are welcome!


## Getting started 

Grab the package: 

```shell
$ npm install @tym17/aki
```

Once installed, few lines of code to bootstrap the agent and its tools:

```ts
import { Agent, tool } from "@tym17/aki";
import { readdir } from "node:fs/promises";

const listDir = tool({
  name: "list_dir",
  description: "List the entries of a directory.",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  // `path` is typed string, inferred from the schema literal above.
  execute: ({ path }) => readdir(path),
});

const agent = new Agent({
  url: "http://127.0.0.1:8080",
  system: "You are terse. Use the tools before answering; never guess.",
  tools: [listDir],
});

const { text } = await agent.run("What is in ./src?");
console.log(text);
```

## What's inside

### Tools are typed from their schema

One schema does two jobs: it constrains the model and types the handler. 

```ts
parameters: {
  type: "object",
  properties: { mount: { type: "string" } },
  required: ["mount"],
},
execute: ({ mount }) => statfsSync(mount).bfree * 4096 / 1e9,
//         ^? string
```

Tools never throw the loop out: an unknown tool, malformed arguments or a
crashing handler all come back as readable text in a `tool` message, which is
what lets a small local model notice and retry.

### Structured output

`json()` uses grammar-constrained decoding

```ts
const commit = await llama.json<{ type: string; subject: string }>(messages, {
  type: "object",
  properties: {
    type: { type: "string", enum: ["feat", "fix", "docs"] },
    subject: { type: "string", maxLength: 72 },
  },
  required: ["type", "subject"],
});
```

### Eval helpers

Eventually, you might want to be sure that your prompts and local model choices are aligned with what you're doing. Running some tests can help you pin point where things might take a weird turn. 

```ts
const suites: EvalSuite[] = [
  {
    name: "core",
    cases: [
      {
        name: "does arithmetic",
        prompt: "12 * 12? Number only.",
        expect: contains("144")
      },
      {
        name: "uses the tool",
        prompt: "how many lines has the file README.md?",
        expect: [ usesTools("count_lines"), contains('128') ],
        options: { tools: [countLines] }
      },
    ],
  },
];
```

> Particularly helpful if you forget to change the description/name of a tool and the big model gets confused and iterates on a simple task for 5 minutes when most smaller models get it done in less than a minute.

This part of the lib allows you to build a benchmark to test your prompts and fine tune your local installation so your model pick and configuration works well for you. 


### Testing without a model

Faster iteration when the model's response is not directly the main focus.

```ts
import { fakeServer } from "@tym17/aki/fake";

const fake = fakeServer([
  { toolCalls: [{ name: "add", arguments: { a: 2, b: 3 } }] },
  { content: "5" },
]);

const agent = new Agent({ client: new LlamaClient({ fetch: fake.fetch }), tools });
const result = await agent.run("2 + 3?");
```

## Samples

Small examples of usages of the lib might be more helpful to see how you can interact with it. Head to the `samples` folder, runs against both a fake server and your local install.

It has more examples like this:

```ts
// ...
const agent = new Agent({
  client: clientFor(fake),
  tools: [countLines],
  onEvent: (event) => {
    if (event.type === "tool_call") console.log(`  → ${event.call.function.name}(${event.call.function.arguments})`);
    if (event.type === "tool_result") console.log(`  ← ${event.content}`);
  },
});

const { text } = await agent.run("How long is the readme?");
console.log(`answer: ${text}`);
// ...
```

## Compatibility

The wire format *should* be similar to OpenAI chat completions (`POST /v1/chat/completions`,
`Authorization: Bearer`), so `url` can point at more than llama.cpp:

| Backend | `url` | Notes | Tested |
| --- | --- | --- | --- |
| `llama-server` | `http://127.0.0.1:8080` | everything works, including `json()` and tok/s from `timings` | √ |
| OpenRouter | `https://openrouter.ai/api` | set `defaults.model`; `json()` works where the model supports it | x |
| Anthropic (OpenAI-compat) | `https://api.anthropic.com` | set `defaults.model`; `response_format` is ignored, so `json()` degrades to prose | x |

Three caveats away from llama.cpp: `model` becomes required. As most of this tiny library is llm generated despite heavy human review and tinkering and I only need it to work for local agents for now, it has only been tested for such purposes. If you happen to test it for one of these or another, any pull request to tick one of the tested boxes would be appreciated :). 

## Notes

- Some of the code is still a work in progress and has not been tested yet
- `cache_prompt` is on by default, reusing the KV cache across turns is most of
  the speed in an agent loop, so keep one client per process.


## License

MIT
