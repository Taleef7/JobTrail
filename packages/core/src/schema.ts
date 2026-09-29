// Schema v2: the extraction contract shared by the eval harness, the web demo
// and the phone app (design doc §5). Zod is the single source of truth; the
// JSON Schemas used for constrained decoding are generated from it
// (scripts/gen-schemas.ts), never written by hand.
import { z } from "zod";

export const JOB_TYPES = [
  "plumbing",
  "electrical",
  "hvac",
  "carpentry",
  "appliance",
  "cleaning",
  "painting",
  "roofing",
  "general",
] as const;

export type JobType = (typeof JOB_TYPES)[number];

const nonEmpty = z.string().min(1);

export const MaterialSchema = z.strictObject({
  name: nonEmpty,
  /** null when the note doesn't say how many (e.g. "some plumber's tape"). */
  quantity: z.number().positive().nullable(),
  unit: nonEmpty.nullable(),
});

export const JobRecordSchema = z.strictObject({
  jobType: z.enum(JOB_TYPES).nullable(),
  /** Completed work, as short action statements. */
  workPerformed: z.array(nonEmpty),
  issuesFound: z.array(nonEmpty),
  materials: z.array(MaterialSchema),
  /** Total labor in whole minutes ("an hour and a half" → 90); null if not mentioned. */
  laborMinutes: z
    .int()
    .min(0)
    .max(24 * 60)
    .nullable(),
  /** Only true/false when the note says so explicitly. */
  customerApproved: z.boolean().nullable(),
  /** Future actions only — never completed work. */
  followUps: z.array(nonEmpty),
});

export type Material = z.infer<typeof MaterialSchema>;
export type JobRecord = z.infer<typeof JobRecordSchema>;
