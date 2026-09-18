import { Agent, fakeServer, tool } from "@tym17/aki";
import { clientFor, heading } from "./_shared.ts";

const weather = tool({
  name: "weather",
  description: "Current conditions for a city.",
  parameters: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  },
  // `city` is typed string here, inferred from the schema above.
  execute: ({ city }) => ({ city, celsius: 12, sky: "rain" }),
});

/** The loop: model asks for a tool, we run it, the model answers with the result. */
export default async function toolCall(): Promise<void> {
  heading("02 · one tool call");

  const fake = fakeServer([
    { toolCalls: [{ name: "weather", arguments: { city: "Lyon" } }] },
    { content: "12 °C and raining in Lyon." },
  ]);

  const agent = new Agent({
    client: clientFor(fake),
    system: "Use the tools. Be terse.",
    tools: [weather],
  });

  const { text, steps } = await agent.run("What's the weather in Lyon?");
  console.log(`answer: ${text}`);
  console.log(`steps:  ${steps} (one to call the tool, one to answer)`);
}
