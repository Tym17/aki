import { Agent, fakeServer, tool } from "@tym17/aki";
import { clientFor, heading } from "./_shared.ts";

const readFile = tool({
  name: "read_file",
  description: "Read a text file.",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  execute: ({ path }) => {
    if (path !== "README.md") throw new Error(`ENOENT: no such file '${path}'`);
    return "# aki\nA tiny agent framework.";
  },
});

/**
 * A crashing tool, then an unknown tool. Neither throws out of the loop —
 * both come back as text the model can read, which is what lets it correct itself.
 */
export default async function errorRecovery(): Promise<void> {
  heading("07 · failures the model can recover from");

  const fake = fakeServer([
    { toolCalls: [{ name: "read_file", arguments: { path: "READM.md" } }] },
    { toolCalls: [{ name: "reed_file", arguments: { path: "README.md" } }] },
    { toolCalls: [{ name: "read_file", arguments: { path: "README.md" } }] },
    { content: "It's the aki readme — a tiny agent framework." },
  ]);

  const agent = new Agent({
    client: clientFor(fake),
    tools: [readFile],
    onEvent: (event) => {
      if (event.type === "tool_result") console.log(`  ← ${event.content.split("\n")[0]}`);
    },
  });

  const { text, steps } = await agent.run("What is in README.md?");
  console.log(`answer: ${text}`);
  console.log(`steps:  ${steps} — two failures absorbed, loop intact`);
}
