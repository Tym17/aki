import {
  absent,
  Agent,
  fakeServer,
  formatReport,
  judge,
  LlamaClient,
  runBench,
  withinSteps,
  type Check,
  type EvalSuite,
} from "@tym17/aki";
import { clientFor, fetchFor, heading } from "./_shared.ts";
import { config } from "./config.ts";

/**
 * A check returns undefined to pass, or a string saying why it failed.
 * Your own checks are therefore indistinguishable from the built-in ones.
 */
const terse = (maxWords: number): Check => (result) => {
  const words = result.text.trim().split(/\s+/).length;
  return words <= maxWords ? undefined : `used ${words} words, budget ${maxWords}`;
};

export default async function customChecks(): Promise<void> {
  heading("09 · custom checks and an LLM judge");

  const suites: EvalSuite[] = [
    {
      name: "style",
      cases: [
        {
          name: "stays terse and cites",
          prompt: "In a few words, less than 20: what does --jinja do?",
          expect: [terse(20), absent("as an AI")],
        },
        {
          name: "answers in French",
          prompt: "Réponds en français : que fait --jinja ?",
          // Judge with a separate, fixed model — grading with the model under test
          // would move the goalposts every time you swap models.
          expect: [withinSteps(2), judge("the answer is written in French", clientFor(fakeServer([{ content: '{"pass":false,"reason":"answer is in English, not French"}' }])))],
        },
      ],
    },
  ];

  const fake = fakeServer([{ content: "Enables the model's chat template, including tools. [1] docs" }]);
  const reports = await runBench(suites, {
    targets: [
      { label: "local", url: config.url }
    ],
    fetch: fetchFor(fake),
    create: (options) => new Agent({ ...options }),
  });

  console.log(formatReport(reports));
  console.log("\nthe judge caught what a keyword check would have missed");
}
