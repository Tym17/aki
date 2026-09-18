import { LlamaClient, type FakeServer } from "@tym17/aki";
import { config } from "./config.ts";

export const clientFor = (fake: FakeServer): LlamaClient =>
  config.live ? new LlamaClient({ url: config.url, apiKey: config.apiKey }) : new LlamaClient({ fetch: fake.fetch });

/** The bench builds its own metered client, so it takes the raw fetch instead. */
export const fetchFor = (fake: FakeServer): typeof globalThis.fetch | undefined =>
  config.live ? globalThis.fetch : fake.fetch;

export const heading = (title: string): void => {
  console.log(`\n\x1b[1m${title}\x1b[0m${config.live ? "  (live)" : "  (fake server)"}`);
};
