import {
  Agent,
  contains,
  fakeServer,
  formatReport,
  noTools,
  runBench,
  tool,
  usesTools,
  type EvalSuite,
} from "@tym17/aki";
import { fetchFor, heading } from "./_shared.ts";
import { config } from "./config.ts";

/** A case is a prompt plus what you expect back. That is the whole format. */
const suites: EvalSuite[] = [
  {
    name: "arithmetic",
    cases: [
      {
        name: "answers directly",
        prompt: "What is 12 * 12? Reply with the number only.",
        expect: [contains("144"), noTools()],
      },
    ],
  },
  {
    name: "tools",
    cases: [
      {
        name: "looks the file up",
        prompt: "How many lines are in README.md?",
        expect: [usesTools("read_file"), contains("128")],
      },
    ],
  },
];

const countLines = tool({
  name: "read_file",
  description: "Read a file and report how many lines it has.",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  execute: ({ path }) => (path === "README.md" ? 128 : 0),
});

export default async function evalBasics(): Promise<void> {
  heading("08 · running an eval suite");

  const fake = fakeServer([], {
    reply: (messages) => {
      const last = messages.at(-1);
      if (last?.role === "tool") return { content: "README.md has 128 lines." };
      if (String(last?.content).includes("12 * 12")) return { content: "144" };
      return { toolCalls: [{ name: "read_file", arguments: { path: "README.md" } }] };
    },
  });

  const reports = await runBench(suites, {
    targets: [
      { label: "local", url: config.url }
    ],
    fetch: fetchFor(fake),
    runs: 2,
    // `create` builds the agent under test. Without it the default agent has no
    // tools, the call errors, and `usesTools` still passes — a green run on a
    // broken setup, which is the one thing an eval must never do.
    create: (options) => new Agent({ ...options, tools: [countLines] }),
  });
  console.log(formatReport(reports));
}
