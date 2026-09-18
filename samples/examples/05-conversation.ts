import { Agent, fakeServer } from "@tym17/aki";
import { clientFor, heading } from "./_shared.ts";

/** State lives on `agent.messages`, so follow-ups continue the thread. */
export default async function conversation(): Promise<void> {
  heading("05 · multi-turn memory");

  const fake = fakeServer([], {
    reply: (messages) => ({ content: `(turn ${messages.filter((m) => m.role === "user").length})` }),
  });

  const agent = new Agent({ client: clientFor(fake), system: "You are terse." });

  console.log(`first:  ${(await agent.run("Bonjour")).text}`);
  console.log(`second: ${(await agent.run("And again in english?")).text}`);
  console.log(`history: ${agent.messages.map((m) => m.role).join(" → ")}`);

  agent.reset();
  console.log(`after reset: ${agent.messages.length} message (the system prompt)`);
}
