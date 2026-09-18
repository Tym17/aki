import { examples } from "./index.ts";

const names = Object.keys(examples);
const [wanted] = process.argv.slice(2);
const chosen = !wanted || wanted === "all" ? names : names.filter((name) => name.startsWith(parseInt(wanted).toString().padStart(2, '0')));

if (!chosen.length) {
  console.log(`unknown example ${JSON.stringify(wanted)}\n\n${names.map((n) => `  ${n}`).join("\n")}`);
  process.exit(1);
}

for (const name of chosen) {
  try {
    await examples[name]!();
  } catch (cause) {
    console.error(`\n${name} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 1;
  }
}
console.log();
