import { fakeServer } from "@tym17/aki";
import { clientFor, heading } from "./_shared.ts";

/** The client on its own — no agent, no tools. One request, one answer. */
export default async function chat(): Promise<void> {
  heading("01 · a single chat call");

  const llama = clientFor(fakeServer([{ content: "Paris." }]));
  const response = await llama.chat([{ role: "user", content: "Capital of France? One word." }]);

  console.log(`answer: ${response.choices[0]?.message.content}`);
  // llama.cpp reports real timings — free tokens/second telemetry.
  console.log(`speed:  ${response.timings?.predicted_per_second?.toFixed(1)} tok/s`);
}
