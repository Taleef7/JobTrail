// The score report contract, consumed by the web results page (#90) and the
// phone benchmark screen (#86). Definitions of every number: SCORING.md.
import { z } from "zod";

const rate = z.number().min(0).max(1);
const nullableRate = rate.nullable();

export const PrfSchema = z.strictObject({ precision: rate, recall: rate, f1: rate });

export const MetricsSchema = z.strictObject({
  n: z.int().min(0),
  parseRate: nullableRate,
  schemaValidRate: nullableRate,
  zeroEditRate: nullableRate,
  jobTypeAccuracy: nullableRate,
  laborMinutesAccuracy: nullableRate,
  customerApprovedAccuracy: nullableRate,
  workPerformed: PrfSchema,
  issuesFound: PrfSchema,
  followUps: PrfSchema,
  materials: z.strictObject({
    precision: rate,
    recall: rate,
    f1: rate,
    /** Share of matched materials whose quantity is exactly right; null if none matched. */
    quantityAccuracy: nullableRate,
  }),
  /** Share of predicted material names/quantities not supported by the note; null if none. */
  hallucinationRate: nullableRate,
  latency: z.strictObject({ p50WallMs: z.number(), p90WallMs: z.number() }).nullable(),
});

const Counts = z.strictObject({ tp: z.int(), fp: z.int(), fn: z.int() });

export const RecordScoreSchema = z.strictObject({
  id: z.string(),
  source: z.string(),
  tags: z.array(z.string()),
  parse: z.enum(["ok", "json", "schema", "missing"]),
  scalars: z.strictObject({
    jobType: z.boolean(),
    laborMinutes: z.boolean(),
    customerApproved: z.boolean(),
  }),
  lists: z.strictObject({ workPerformed: Counts, issuesFound: Counts, followUps: Counts }),
  materials: z.strictObject({
    tp: z.int(),
    fp: z.int(),
    fn: z.int(),
    quantityCorrect: z.int(),
    unitCorrect: z.int(),
  }),
  grounding: z.strictObject({ checked: z.int(), ungrounded: z.int() }),
  zeroEdit: z.boolean(),
  wallMs: z.number().nullable(),
});

export const ScoreReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  run: z.string(),
  model: z.string().nullable(),
  matcher: z.strictObject({
    method: z.literal("token-dice"),
    threshold: z.number(),
    provisional: z.boolean(),
  }),
  overall: MetricsSchema,
  bySource: z.record(z.string(), MetricsSchema),
  byTag: z.record(z.string(), MetricsSchema),
  unmatchedPredictionIds: z.array(z.string()),
  records: z.array(RecordScoreSchema),
});

export type Metrics = z.infer<typeof MetricsSchema>;
export type RecordScore = z.infer<typeof RecordScoreSchema>;
export type ScoreReport = z.infer<typeof ScoreReportSchema>;
