import { fakeServer } from "@tym17/aki";
import { clientFor, heading } from "./_shared.ts";

interface Commit {
  type: string;
  scope?: string;
  subject: string;
}

/**
 * Constrained decoding: llama.cpp compiles the schema to a grammar, so the shape
 * is right by construction. No retry loop, no "please reply in JSON" in the prompt.
 */
export default async function structuredOutput(): Promise<void> {
  heading("06 · guaranteed JSON shape");

  const fake = fakeServer([{ content: '{"type":"feat","scope":"eval","subject":"add bench targets"}' }]);
  const llama = clientFor(fake);

  const commit = await llama.json<Commit>(
    [
      { role: "system", content: "Write a Conventional Commit for the diff." },
      { role: "user", content: "+ added multi-model benchmarking to the eval runner" },
    ],
    {
      type: "object",
      properties: {
        type: { type: "string", enum: ["feat", "fix", "refactor", "docs", "test", "chore"] },
        scope: { type: "string" },
        subject: { type: "string", maxLength: 72 },
      },
      required: ["type", "subject"],
    },
  );

  console.log(`${commit.type}${commit.scope ? `(${commit.scope})` : ""}: ${commit.subject}`);
  console.log("parsed straight into a typed object — no string wrangling");
}
