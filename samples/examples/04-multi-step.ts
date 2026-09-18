import { Agent, fakeServer, tool } from "@tym17/aki";
import { clientFor, heading } from "./_shared.ts";

const countLines = tool({
  name: "count_lines",
  description: "Count the lines in a file.",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  execute: ({ path }) => (path.endsWith(".md") ? 128 : 42),
});

/**
 * `reply` makes the fake react to the conversation instead of reading a script,
 * which is how you exercise a loop of unknown length.
 */
export default async function multiStep(): Promise<void> {
  heading("04 · a loop that reacts to tool output");

  const fake = fakeServer([], {
    reply: (messages) => {
      const last = messages.at(-1);
      if (last?.role === "tool") return { content: `README.md has ${last.content} lines.` };
      return { toolCalls: [{ name: "count_lines", arguments: { path: "README.md" } }] };
    },
  });

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
}
