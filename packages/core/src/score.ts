// The single scorer: every metric in README/web/mobile comes from here.
// Definitions and conventions are documented in SCORING.md.
import { z } from "zod";
import { MATCH_THRESHOLD, matchOneToOne, normalizeTokens } from "./match.ts";
import { parseModelOutput } from "./parse.ts";
import type { Metrics, RecordScore, ScoreReport } from "./report.ts";
import { JobRecordSchema, type JobRecord } from "./schema.ts";

/** One gold line (data/README.md). The nested record must satisfy schema v2. */
export const GoldRecordSchema = z.object({
  id: z.string().min(1),
  note: z.string(),
  gold: JobRecordSchema,
  source: z.string().min(1),
  tags: z.array(z.string()),
  verified: z.boolean().optional(),
});

const ms = z.number().nonnegative().optional();

/** One prediction line; `raw` is the model's text exactly as generated. */
export const PredictionRecordSchema = z.object({
  id: z.string().min(1),
  raw: z.string(),
  format: z.enum(["full", "compact"]).optional(),
  model: z.string().optional(),
  timings: z
    .object({ wallMs: ms, ttftMs: ms, prefillTokPerSec: ms, decodeTokPerSec: ms })
    .optional(),
});

export type GoldRecord = z.infer<typeof GoldRecordSchema>;
export type PredictionRecord = z.infer<typeof PredictionRecordSchema>;
export type { JobRecord };

export interface ScoreOptions {
  run: string;
  model?: string | null;
  threshold?: number;
  /** True until the matcher threshold is validated against human labels. */
  provisionalMatcher?: boolean;
}

type Counts = { tp: number; fp: number; fn: number };
const LIST_FIELDS = ["workPerformed", "issuesFound", "followUps"] as const;

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, dozen: 12, half: 0.5, couple: 2, pair: 2,
}; // prettier-ignore

function numbersInText(text: string): Set<number> {
  const found = new Set<number>();
  for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) found.add(Number(m[0]));
  for (const t of text.toLowerCase().split(/[^a-z]+/)) {
    const n = NUMBER_WORDS[t];
    if (n !== undefined) found.add(n);
  }
  return found;
}

// "a few" / "a bunch of" is not 1; "a couple" / "a dozen" / "a half" are number words above.
const VAGUE_AFTER_ARTICLE = new Set([
  "few", "bunch", "handful", "lot", "little", "bit", "couple", "pair", "dozen", "half",
]); // prettier-ignore
const ARTICLE_REACH = 3;

/**
 * "a new wax ring" says 1, but only for the material it introduces: the article
 * must be followed, within ARTICLE_REACH content words of the same clause, by a
 * token of the material's name or unit ("a box of deck screws"). See SCORING.md.
 */
function articleIntroduces(note: string, material: JobRecord["materials"][number]): boolean {
  const targets = new Set(normalizeTokens(`${material.name} ${material.unit ?? ""}`));
  for (const clause of note.toLowerCase().split(/[,.;:!?]/)) {
    const words = clause.split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const word = words[i]?.replace(/[^a-z]/g, "");
      if (word !== "a" && word !== "an") continue;
      const next = normalizeTokens(words.slice(i + 1).join(" ")).slice(0, ARTICLE_REACH);
      if (next[0] !== undefined && VAGUE_AFTER_ARTICLE.has(next[0])) continue;
      if (next.some((t) => targets.has(t))) return true;
    }
  }
  return false;
}

function grounding(note: string, predicted: JobRecord): RecordScore["grounding"] {
  const noteTokens = new Set(normalizeTokens(note));
  const noteNumbers = numbersInText(note);
  let checked = 0;
  let ungrounded = 0;
  for (const m of predicted.materials) {
    const tokens = normalizeTokens(m.name);
    const supported = tokens.filter((t) => noteTokens.has(t)).length;
    checked++;
    if (tokens.length === 0 || supported * 2 < tokens.length) ungrounded++;
    if (m.quantity !== null) {
      checked++;
      const said = noteNumbers.has(m.quantity) || (m.quantity === 1 && articleIntroduces(note, m));
      if (!said) ungrounded++;
    }
  }
  return { checked, ungrounded };
}

const sameUnit = (a: string | null, b: string | null) =>
  a === null || b === null
    ? a === b
    : normalizeTokens(a).join(" ") === normalizeTokens(b).join(" ");

function failed(gold: GoldRecord, parse: RecordScore["parse"], wallMs: number | null): RecordScore {
  const miss = (items: unknown[]): Counts => ({ tp: 0, fp: 0, fn: items.length });
  return {
    id: gold.id,
    source: gold.source,
    tags: gold.tags,
    parse,
    scalars: { jobType: false, laborMinutes: false, customerApproved: false },
    lists: {
      workPerformed: miss(gold.gold.workPerformed),
      issuesFound: miss(gold.gold.issuesFound),
      followUps: miss(gold.gold.followUps),
    },
    materials: { ...miss(gold.gold.materials), quantityCorrect: 0, unitCorrect: 0 },
    grounding: { checked: 0, ungrounded: 0 },
    zeroEdit: false,
    wallMs,
  };
}

export function scoreRecord(
  gold: GoldRecord,
  pred: PredictionRecord | undefined,
  threshold = MATCH_THRESHOLD,
): RecordScore {
  if (!pred) return failed(gold, "missing", null);
  const wallMs = pred.timings?.wallMs ?? null;
  const parsed = parseModelOutput(pred.raw, { format: pred.format ?? "full" });
  if (!parsed.ok) return failed(gold, parsed.stage, wallMs);

  const g = gold.gold;
  const p = parsed.value;
  const lists = Object.fromEntries(
    LIST_FIELDS.map((field) => {
      const r = matchOneToOne(p[field], g[field], threshold);
      return [
        field,
        { tp: r.pairs.length, fp: r.unmatchedPred.length, fn: r.unmatchedGold.length },
      ];
    }),
  ) as RecordScore["lists"];

  const mm = matchOneToOne(
    p.materials.map((m) => m.name),
    g.materials.map((m) => m.name),
    threshold,
  );
  let quantityCorrect = 0;
  let unitCorrect = 0;
  for (const { pred: i, gold: j } of mm.pairs) {
    const pm = p.materials[i];
    const gm = g.materials[j];
    if (!pm || !gm) continue;
    if (pm.quantity === gm.quantity) quantityCorrect++;
    if (sameUnit(pm.unit, gm.unit)) unitCorrect++;
  }
  const materials = {
    tp: mm.pairs.length,
    fp: mm.unmatchedPred.length,
    fn: mm.unmatchedGold.length,
    quantityCorrect,
    unitCorrect,
  };

  const scalars = {
    jobType: p.jobType === g.jobType,
    laborMinutes: p.laborMinutes === g.laborMinutes,
    customerApproved: p.customerApproved === g.customerApproved,
  };
  const zeroEdit =
    Object.values(scalars).every(Boolean) &&
    Object.values(lists).every((c) => c.fp === 0 && c.fn === 0) &&
    materials.fp === 0 &&
    materials.fn === 0 &&
    quantityCorrect === materials.tp &&
    unitCorrect === materials.tp;

  return {
    id: gold.id,
    source: gold.source,
    tags: gold.tags,
    parse: "ok",
    scalars,
    lists,
    materials,
    grounding: grounding(gold.note, p),
    zeroEdit,
    wallMs,
  };
}

const ratio = (num: number, den: number) => (den === 0 ? null : num / den);

/** Micro P/R/F1. Nothing predicted → precision 1; nothing to find → recall 1. */
function prf(c: Counts) {
  const precision = c.tp + c.fp === 0 ? 1 : c.tp / (c.tp + c.fp);
  const recall = c.tp + c.fn === 0 ? 1 : c.tp / (c.tp + c.fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

/** Nearest-rank percentile. */
function percentile(sorted: number[], p: number): number {
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? Number.NaN;
}

export function aggregate(scores: RecordScore[]): Metrics {
  const n = scores.length;
  const count = (f: (s: RecordScore) => boolean) => scores.filter(f).length;
  const sum = (f: (s: RecordScore) => Counts): Counts =>
    scores.reduce(
      (acc, s) => {
        const c = f(s);
        return { tp: acc.tp + c.tp, fp: acc.fp + c.fp, fn: acc.fn + c.fn };
      },
      { tp: 0, fp: 0, fn: 0 },
    );
  const materialCounts = sum((s) => s.materials);
  const quantityCorrect = scores.reduce((a, s) => a + s.materials.quantityCorrect, 0);
  const checked = scores.reduce((a, s) => a + s.grounding.checked, 0);
  const ungrounded = scores.reduce((a, s) => a + s.grounding.ungrounded, 0);
  const walls = scores.flatMap((s) => (s.wallMs === null ? [] : [s.wallMs])).sort((a, b) => a - b);

  return {
    n,
    parseRate: ratio(
      count((s) => s.parse === "ok" || s.parse === "schema"),
      n,
    ),
    schemaValidRate: ratio(
      count((s) => s.parse === "ok"),
      n,
    ),
    zeroEditRate: ratio(
      count((s) => s.zeroEdit),
      n,
    ),
    jobTypeAccuracy: ratio(
      count((s) => s.scalars.jobType),
      n,
    ),
    laborMinutesAccuracy: ratio(
      count((s) => s.scalars.laborMinutes),
      n,
    ),
    customerApprovedAccuracy: ratio(
      count((s) => s.scalars.customerApproved),
      n,
    ),
    workPerformed: prf(sum((s) => s.lists.workPerformed)),
    issuesFound: prf(sum((s) => s.lists.issuesFound)),
    followUps: prf(sum((s) => s.lists.followUps)),
    materials: {
      ...prf(materialCounts),
      quantityAccuracy: ratio(quantityCorrect, materialCounts.tp),
    },
    hallucinationRate: ratio(ungrounded, checked),
    latency:
      walls.length === 0
        ? null
        : { p50WallMs: percentile(walls, 50), p90WallMs: percentile(walls, 90) },
  };
}

function groupBy(scores: RecordScore[], keys: (s: RecordScore) => string[]) {
  const groups = new Map<string, RecordScore[]>();
  for (const s of scores) for (const k of keys(s)) groups.set(k, [...(groups.get(k) ?? []), s]);
  return Object.fromEntries(
    [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, aggregate(v)]),
  );
}

export function scoreRun(
  golds: GoldRecord[],
  preds: PredictionRecord[],
  options: ScoreOptions,
): ScoreReport {
  const threshold = options.threshold ?? MATCH_THRESHOLD;
  // Dice is in [0, 1]; 0 would pair everything and > 1 nothing — both silently corrupt scores.
  if (!(threshold > 0 && threshold <= 1)) {
    throw new Error(`matcher threshold must be in (0, 1], got ${threshold}`);
  }
  const dupes = (ids: string[]) => [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  const dupGold = dupes(golds.map((g) => g.id));
  if (dupGold.length > 0) throw new Error(`duplicate gold id(s): ${dupGold.join(", ")}`);
  const dupPred = dupes(preds.map((p) => p.id));
  if (dupPred.length > 0) {
    throw new Error(
      `duplicate prediction id(s): ${dupPred.join(", ")} (e.g. a resumed run appended retries)`,
    );
  }
  const byId = new Map(preds.map((p) => [p.id, p]));
  const goldIds = new Set(golds.map((g) => g.id));
  const records = golds.map((g) => scoreRecord(g, byId.get(g.id), threshold));
  return {
    schemaVersion: 1,
    run: options.run,
    model: options.model ?? preds.find((p) => p.model)?.model ?? null,
    matcher: { method: "token-dice", threshold, provisional: options.provisionalMatcher ?? true },
    overall: aggregate(records),
    bySource: groupBy(records, (s) => [s.source]),
    byTag: groupBy(records, (s) => s.tags),
    unmatchedPredictionIds: preds.map((p) => p.id).filter((id) => !goldIds.has(id)),
    records,
  };
}
