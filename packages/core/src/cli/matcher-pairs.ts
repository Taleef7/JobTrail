// pnpm matcher-pairs --drafts <drafts.jsonl> --out <pairs.csv> [--seed N] [--per-bin N]
//   [--exclude <pairs.csv>]...
// Samples held-out matcher-validation pairs (#114) from real extractions: each
// draft's blind checker output ("predicted") against its planned gold, item by
// item within the same field. Pairs are stratified by the original token-Dice
// score so the sample spans clear misses to near-identical wording; pairs that
// are identical after normalization are left out as uninformative. Labels are
// added afterwards, before the matcher is run on the set.
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { normalizeTokens } from "../match.ts";
import { parseCsv } from "./csv.ts";
import { readJsonl } from "./jsonl.ts";

const Extraction = z.object({
  workPerformed: z.array(z.string()),
  issuesFound: z.array(z.string()),
  materials: z.array(z.object({ name: z.string() })),
  followUps: z.array(z.string()),
});
const DraftSchema = z.object({
  id: z.string(),
  gold: Extraction,
  meta: z.object({ checked: Extraction.nullable().optional() }),
});
type Draft = z.infer<typeof DraftSchema>;

export interface Pair {
  kind: "material" | "statement";
  predicted: string;
  gold: string;
  source: string;
  dice: number;
}

/** The token-Dice score the matcher used before #114, kept fixed for stratification. */
export function baseDice(a: string, b: string): number {
  const A = new Set(normalizeTokens(a));
  const B = new Set(normalizeTokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return (2 * shared) / (A.size + B.size);
}

const STATEMENT_FIELDS = ["workPerformed", "issuesFound", "followUps"] as const;

/** Matching and the same/different judgment are symmetric, so "A vs B" is "B vs A". */
export const pairKey = (kind: string, p: string, g: string) =>
  `${kind}|${[p.toLowerCase(), g.toLowerCase()].sort().join("|")}`;

/** Keys of the pairs already in other validation sets, so a new set never repeats them. */
export function excludedKeys(csvs: string[]): Set<string> {
  const keys = new Set<string>();
  for (const text of csvs) {
    const [header, ...rows] = parseCsv(text);
    const at = (name: string) => header?.indexOf(name) ?? -1;
    for (const r of rows)
      keys.add(pairKey(r[at("kind")] ?? "", r[at("predicted")] ?? "", r[at("gold")] ?? ""));
  }
  return keys;
}

export function candidatePairs(drafts: Draft[], exclude = new Set<string>()): Pair[] {
  const seen = new Set<string>(exclude);
  const out: Pair[] = [];
  const add = (kind: Pair["kind"], p: string, g: string, source: string) => {
    const key = pairKey(kind, p, g);
    if (seen.has(key)) return;
    seen.add(key);
    const dice = baseDice(p, g);
    if (dice < 1) out.push({ kind, predicted: p, gold: g, source, dice });
  };
  for (const d of drafts) {
    const c = d.meta.checked;
    if (!c) continue;
    for (const p of c.materials)
      for (const g of d.gold.materials) add("material", p.name, g.name, d.id);
    for (const f of STATEMENT_FIELDS)
      for (const p of c[f]) for (const g of d.gold[f]) add("statement", p, g, d.id);
  }
  return out;
}

/** mulberry32: small seeded PRNG so the sample is reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BINS = [
  { name: "0", test: (d: number) => d === 0 },
  { name: "(0,0.5)", test: (d: number) => d > 0 && d < 0.5 },
  { name: "[0.5,0.75)", test: (d: number) => d >= 0.5 && d < 0.75 },
  { name: "[0.75,1)", test: (d: number) => d >= 0.75 && d < 1 },
];

/** Per score bin, half materials and half statements where available, seeded. */
export function samplePairs(pairs: Pair[], perBin: number, seed: number): Pair[] {
  const next = rng(seed);
  const shuffle = <T>(xs: T[]): T[] => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [a[i], a[j]] = [a[j] as T, a[i] as T];
    }
    return a;
  };
  const out: Pair[] = [];
  for (const bin of BINS) {
    const inBin = pairs.filter((p) => bin.test(p.dice));
    const mats = shuffle(inBin.filter((p) => p.kind === "material"));
    const stmts = shuffle(inBin.filter((p) => p.kind === "statement"));
    const nMat = Math.min(mats.length, Math.ceil(perBin / 2));
    const nStmt = Math.min(stmts.length, perBin - nMat);
    out.push(...mats.slice(0, nMat), ...stmts.slice(0, nStmt));
    const short = perBin - nMat - nStmt;
    if (short > 0) out.push(...mats.slice(nMat, nMat + short));
  }
  return out;
}

const csvField = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function toCsv(pairs: Pair[]): string {
  const rows = pairs.map((p, i) =>
    [`hv-${String(i + 1).padStart(2, "0")}`, p.kind, p.predicted, p.gold, "", "", p.source]
      .map(csvField)
      .join(","),
  );
  return `${["id,kind,predicted,gold,same,votes,source", ...rows].join("\n")}\n`;
}

export function main(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      drafts: { type: "string" },
      out: { type: "string" },
      seed: { type: "string", default: "114" },
      "per-bin": { type: "string", default: "15" },
      exclude: { type: "string", multiple: true, default: [] },
    },
  });
  if (!values.drafts || !values.out) {
    console.error("usage: pnpm matcher-pairs --drafts <drafts.jsonl> --out <pairs.csv>");
    return 2;
  }
  const drafts = readJsonl(values.drafts, DraftSchema);
  const exclude = excludedKeys(values.exclude.map((f) => readFileSync(f, "utf8")));
  const pairs = samplePairs(
    candidatePairs(drafts, exclude),
    Number(values["per-bin"]),
    Number(values.seed),
  );
  writeFileSync(values.out, toCsv(pairs));
  console.log(`${pairs.length} pairs from ${drafts.length} drafts → ${values.out}`);
  return 0;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
