import { Agent, fakeServer } from "@tym17/aki";
import { clientFor, heading } from "./_shared.ts";

/** Tokens arrive through the same event channel as everything else. */
export default async function streaming(): Promise<void> {
  heading("03 · streaming tokens");

  const fake = fakeServer([{ content: "Type stripping means Node runs the TypeScript directly." }], {
    streamDelay: 25,
  });

  const agent = new Agent({
    client: clientFor(fake),
    stream: true,
    onEvent: (event) => {
      if (event.type === "token") process.stdout.write(event.text);
      if (event.type === "done") process.stdout.write("\n");
    },
  });

  await agent.run("Explain type stripping in one sentence.");
}
