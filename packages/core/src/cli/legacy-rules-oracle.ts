// pnpm --filter @jobtrail/core legacy-oracle
// Runs the UNMODIFIED legacy RuleBasedAiProvider (read straight from the
// legacy-v0 tag) on fixtures/baseline/notes.json and records its raw outputs.
// The port in src/baselines/rules.ts must reproduce them exactly (rules.test.ts).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const TAG = "legacy-v0";
const LEGACY_PATH = "apps/mobile/src/ai/RuleBasedAiProvider.ts";
const fixtures = join(import.meta.dirname, "..", "..", "fixtures", "baseline");

interface LegacyProvider {
  extractJobFields(input: { noteText: string; jobId: string }): Promise<unknown>;
}

async function main() {
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });
  const source = git("show", `${TAG}:${LEGACY_PATH}`);
  const blob = git("rev-parse", `${TAG}:${LEGACY_PATH}`).trim();

  // Its only imports are type-only, so Node's type stripping runs it as-is.
  const file = join(mkdtempSync(join(tmpdir(), "jobtrail-legacy-")), "RuleBasedAiProvider.ts");
  writeFileSync(file, source);
  const mod = (await import(pathToFileURL(file).href)) as {
    RuleBasedAiProvider: new () => LegacyProvider;
  };
  const provider = new mod.RuleBasedAiProvider();

  const notes = JSON.parse(readFileSync(join(fixtures, "notes.json"), "utf8")) as {
    id: string;
    note: string;
  }[];
  const outputs = [];
  for (const { id, note } of notes) {
    outputs.push({ id, output: await provider.extractJobFields({ noteText: note, jobId: id }) });
  }
  const out = join(fixtures, "legacy-outputs.json");
  writeFileSync(
    out,
    `${JSON.stringify({ source: { tag: TAG, path: LEGACY_PATH, blob }, outputs }, null, 2)}\n`,
  );
  console.log(`wrote ${outputs.length} legacy outputs to ${out} (blob ${blob})`);
}

if (import.meta.main) await main();
