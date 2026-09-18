import { contains, fakeServer, formatReport, LlamaClient, runBench, tool, usesTools, type EvalSuite, type TargetReport } from "@tym17/aki";
import { heading } from "./_shared.ts";
import { config } from "./config.ts";


  const countLines = tool({
    name: "count_lines",
    description: "Read a file and report how many lines it has.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    execute: ({ path }) => (path === "README.md" ? 128 : 0),
  });

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

/**
 * No offline mode for this one,
 * also be careful as it requires llama.cpp
 * to be started in router mode for this one to work
 */
export default async function benchModels(): Promise<void> {
  heading("10 · benchmarking two models");


  const models = [
    'granite-4.1-8b-Q4_K_M',
    'granite-4.1-8b-Q5_K_M',
  ]

  const targets = models.map(m => ({
    label: m,
    url: config.url,
    model: m
  }))

    const reports = await runBench(suites, {
      targets,
      runs: 3, 
    });
   

  console.log(formatReport(reports));
  console.log("\n--runs 3 matters: a single green run on a local model means little");
}
