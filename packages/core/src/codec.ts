// Compact encoding for model output. Fine-tuned models emit single-letter keys,
// which cuts decode tokens — and #66 showed decode time dominates on short
// prompts. Keys: t=jobType w=workPerformed i=issuesFound m=materials
// (n=name q=quantity u=unit) l=laborMinutes a=customerApproved f=followUps.
import { z } from "zod";
import { JOB_TYPES, type JobRecord } from "./schema";

const nonEmpty = z.string().min(1);

export const CompactMaterialSchema = z.strictObject({
  n: nonEmpty,
  q: z.number().positive().nullable(),
  u: nonEmpty.nullable(),
});

export const CompactRecordSchema = z.strictObject({
  t: z.enum(JOB_TYPES).nullable(),
  w: z.array(nonEmpty),
  i: z.array(nonEmpty),
  m: z.array(CompactMaterialSchema),
  l: z
    .int()
    .min(0)
    .max(24 * 60)
    .nullable(),
  a: z.boolean().nullable(),
  f: z.array(nonEmpty),
});

export type CompactRecord = z.infer<typeof CompactRecordSchema>;

export function encodeCompact(r: JobRecord): CompactRecord {
  return {
    t: r.jobType,
    w: r.workPerformed,
    i: r.issuesFound,
    m: r.materials.map((m) => ({ n: m.name, q: m.quantity, u: m.unit })),
    l: r.laborMinutes,
    a: r.customerApproved,
    f: r.followUps,
  };
}

export function decodeCompact(c: CompactRecord): JobRecord {
  return {
    jobType: c.t,
    workPerformed: c.w,
    issuesFound: c.i,
    materials: c.m.map((m) => ({ name: m.n, quantity: m.q, unit: m.u })),
    laborMinutes: c.l,
    customerApproved: c.a,
    followUps: c.f,
  };
}
