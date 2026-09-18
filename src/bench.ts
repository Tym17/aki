import { Agent, type AgentOptions } from "./agent.ts";
import { LlamaClient } from "./client.ts";
import { checkAll, type EvalCase, type EvalResult, type EvalSuite } from "./eval.ts";

/** One model to measure. Compare sizes by running a llama-server per port. */
export interface Target {
  label: string;
  url?: string;
  apiKey?: string;
  model?: string;
  options?: AgentOptions;
}

export interface CaseReport {
  suite: string;
  name: string;
  passed: number;
  runs: number;
  failures: string[];
  /** Median wall time across runs. */
  ms: number;
  tokensPerSecond: number;
}

export interface TargetReport {
  target: string;
  cases: CaseReport[];
  passed: number;
  total: number;
  ms: number;
  tokensPerSecond: number;
}

export interface BenchOptions {
  targets?: Target[];
  /** Repeats per case. Local models are non-deterministic; 3 is a decent default for real work. */
  runs?: number;
  /** Builds the agent under test — pass your repo's factory so evals exercise the real thing. */
  create?: (options: AgentOptions) => Agent;
  /** Underlying fetch; the meter wraps it. Point it at a fake server to run evals offline. */
  fetch?: typeof globalThis.fetch;
  onCase?: (target: string, report: CaseReport) => void;
  /**
   * Spinner on stderr naming the target in flight, one ✓ line per finished target.
   * Defaults to on when stderr is a TTY, so pipes and CI logs stay clean.
   */
  progress?: boolean;
  /**
   * Throwaway request per target before anything is timed, so llama-server's lazy
   * model load lands outside the measurements. On by default — turn it off only
   * if you want the first case to include load time on purpose.
   */
  warmup?: boolean;
}

/**
 * Wraps fetch to read llama.cpp's `timings` off each response.
 * Speed measurement needs no changes anywhere else — the client already takes a `fetch`.
 */
export function meter(inner: typeof globalThis.fetch = globalThis.fetch.bind(globalThis)) {
  const stats = { tokens: 0, ms: 0 };

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const started = performance.now();
    const res = await inner(input, init);
    const elapsed = performance.now() - started;
    try {
      const body = await res.clone().json();
      stats.tokens += body?.timings?.predicted_n ?? body?.usage?.completion_tokens ?? 0;
      stats.ms += body?.timings?.predicted_ms ?? elapsed;
    } catch {
      // not a JSON body — nothing to meter
    }
    return res;
  };

  return { fetch, stats };
}

export async function runBench(suites: EvalSuite[], options: BenchOptions = {}): Promise<TargetReport[]> {
  const {
    targets = [{ label: "default" }],
    runs = 1,
    create = (agentOptions: AgentOptions) => new Agent(agentOptions),
    fetch,
    onCase,
    progress = isTTY(),
    warmup = true,
  } = options;
  const reports: TargetReport[] = [];
  const caseCount = suites.reduce((total, suite) => total + suite.cases.length, 0);

  for (const target of targets) {
    const cases: CaseReport[] = [];
    const spin = progress ? spinner(target.label, caseCount) : null;
    const targetStarted = performance.now();

    try {
      if (warmup) {
        spin?.note("warming up");
        await warm(target, fetch);
        spin?.note("");
      }

      for (const suite of suites) {
        for (const evalCase of suite.cases) {
          const durations: number[] = [];
          const speeds: number[] = [];
          const failures = new Set<string>();
          let passed = 0;

          for (let run = 0; run < runs; run++) {
            const result = await once(target, suite, evalCase, create, fetch);
            const found = await checkAll(evalCase.expect, result);
            for (const failure of found) failures.add(failure);
            if (!found.length) passed++;
            durations.push(result.ms);
            speeds.push(result.tokensPerSecond);
          }

          const report: CaseReport = {
            suite: suite.name,
            name: evalCase.name,
            passed,
            runs,
            failures: [...failures],
            ms: median(durations),
            tokensPerSecond: mean(speeds),
          };
          cases.push(report);
          spin?.tick();
          onCase?.(target.label, report);
        }
      }
    } catch (error) {
      spin?.fail();
      throw error;
    }

    const report: TargetReport = {
      target: target.label,
      cases,
      passed: cases.filter((c) => c.passed === c.runs).length,
      total: cases.length,
      ms: median(cases.map((c) => c.ms)),
      tokensPerSecond: mean(cases.map((c) => c.tokensPerSecond)),
    };
    reports.push(report);
    spin?.done(`${report.passed}/${report.total} cases, ${((performance.now() - targetStarted) / 1000).toFixed(1)} s`);
  }

  return reports;
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const isTTY = (): boolean => Boolean(globalThis.process?.stderr?.isTTY);

/**
 * One line on stderr per target: a spinner while it runs, ✓ or ✗ once it's done.
 * A bench run is long and silent otherwise — this says which model is in flight.
 * Without a TTY (or without a `process`) it degrades to plain lines, never escape codes.
 */
function spinner(label: string, caseCount: number) {
  const stream = globalThis.process?.stderr;
  if (!stream) return null;

  const tty = Boolean(stream.isTTY);
  let frame = 0;
  let finished = 0;
  let hint = "";
  let timer: ReturnType<typeof setInterval> | undefined;

  // A phase note wins over the case counter: during warmup there is nothing to count yet.
  const suffix = () => {
    const text = hint || (caseCount ? `${finished}/${caseCount}` : "");
    return text ? ` \u001b[2m${text}\u001b[0m` : "";
  };
  const draw = () => stream.write(`\r\u001b[2K${FRAMES[frame++ % FRAMES.length]} ${label}${suffix()}`);
  const clear = () => stream.write("\r\u001b[2K");

  if (tty) {
    draw();
    timer = setInterval(draw, 80);
    // Never hold the process open for a cosmetic timer.
    (timer as { unref?: () => void }).unref?.();
  } else {
    stream.write(`… ${label}\n`);
  }

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    if (tty) clear();
  };

  return {
    /** Replaces the counter with a phase name; pass "" to hand the line back to the counter. */
    note(text: string) {
      hint = text;
      if (tty) draw();
    },
    tick() {
      finished++;
      if (tty) draw();
    },
    done(summary: string) {
      stop();
      stream.write(`✓ ${label} (${summary})\n`);
    },
    fail() {
      stop();
      stream.write(`✗ ${label}\n`);
    },
  };
}

async function once(
  target: Target,
  suite: EvalSuite,
  evalCase: EvalCase,
  create: (options: AgentOptions) => Agent,
  baseFetch?: typeof globalThis.fetch,
): Promise<EvalResult> {
  const { fetch, stats } = meter(baseFetch);
  const client = new LlamaClient({ url: target.url, apiKey: target.apiKey, defaults: { model: target.model }, fetch });

  // `stream: false` last and non-negotiable: the meter reads whole JSON responses,
  // and an eval has nobody to stream to.
  const agent = create({ ...suite.options, ...target.options, ...evalCase.options, client, stream: false });

  const started = performance.now();
  const run = await agent.run(evalCase.prompt);
  const ms = performance.now() - started;

  return {
    text: run.text,
    messages: run.messages,
    tools: run.messages.flatMap((m) => m.tool_calls ?? []).map((call) => call.function.name),
    steps: run.steps,
    ms,
    tokens: stats.tokens,
    tokensPerSecond: stats.ms > 0 ? (stats.tokens / stats.ms) * 1000 : 0,
  };
}

/**
 * One token out of the target before the clock starts.
 * llama-server loads weights on the first request that names a model, so without
 * this the first case of every target pays for the load and reads as pathologically
 * slow — worse, it is the case ordering, not the model, that decides who pays.
 *
 * Deliberately not metered: it uses the raw fetch, so its tokens reach no report.
 * Deliberately quiet: a server that is down or a model that is missing is the first
 * real case's news to break, with a proper error, not this one's.
 */
async function warm(target: Target, baseFetch?: typeof globalThis.fetch): Promise<void> {
  const client = new LlamaClient({
    url: target.url,
    apiKey: target.apiKey,
    defaults: { model: target.model },
    fetch: baseFetch,
  });

  try {
    await client.chat([{ role: "user", content: "hi" }], { max_tokens: 1 });
  } catch {
    // see above — the measured run reports what is actually wrong
  }
}

export function formatReport(reports: TargetReport[]): string {
  const head = ["model", "cases", "p50", "speed"];
  const rows = reports.map((report) => [
    report.target,
    `${report.passed}/${report.total}`,
    `${(report.ms / 1000).toFixed(2)} s`,
    `${report.tokensPerSecond.toFixed(1)} tok/s`,
  ]);
  const widths = head.map((_, i) => Math.max(...[head, ...rows].map((row) => row[i]!.length)));
  const line = (row: string[]) => row.map((cell, i) => cell.padEnd(widths[i]!)).join("  ").trimEnd();

  const out = [line(head), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)];

  for (const report of reports) {
    const failed = report.cases.filter((c) => c.passed < c.runs);
    if (!failed.length) continue;
    out.push("", `${report.target}:`);
    for (const c of failed) {
      out.push(`  ✗ ${c.suite} / ${c.name}  (${c.passed}/${c.runs} runs)`);
      out.push(...c.failures.map((failure) => `      ${failure}`));
    }
  }

  return out.join("\n");
}

const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const mean = (values: number[]): number =>
  values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
