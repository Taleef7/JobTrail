import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CompactRecordSchema, decodeCompact, encodeCompact } from "./codec";
import { JOB_TYPES, JobRecordSchema, type JobRecord } from "./schema";

const text = fc.string({ minLength: 1, maxLength: 40 });
const record: fc.Arbitrary<JobRecord> = fc.record({
  jobType: fc.option(fc.constantFrom(...JOB_TYPES), { nil: null }),
  workPerformed: fc.array(text, { maxLength: 4 }),
  issuesFound: fc.array(text, { maxLength: 4 }),
  materials: fc.array(
    fc.record({
      name: text,
      quantity: fc.option(fc.double({ min: 0.01, max: 1000, noNaN: true }), { nil: null }),
      unit: fc.option(text, { nil: null }),
    }),
    { maxLength: 5 },
  ),
  laborMinutes: fc.option(fc.integer({ min: 0, max: 24 * 60 }), { nil: null }),
  customerApproved: fc.option(fc.boolean(), { nil: null }),
  followUps: fc.array(text, { maxLength: 4 }),
});

describe("compact codec", () => {
  it("maps keys to the documented short form", () => {
    const compact = encodeCompact({
      jobType: "hvac",
      workPerformed: ["Replaced thermostat"],
      issuesFound: [],
      materials: [{ name: "Wire nut", quantity: 3, unit: null }],
      laborMinutes: 120,
      customerApproved: false,
      followUps: [],
    });
    expect(compact).toEqual({
      t: "hvac",
      w: ["Replaced thermostat"],
      i: [],
      m: [{ n: "Wire nut", q: 3, u: null }],
      l: 120,
      a: false,
      f: [],
    });
  });

  it("round-trips any valid record: decode(encode(r)) === r", () => {
    fc.assert(
      fc.property(record, (r) => {
        expect(JobRecordSchema.safeParse(r).success).toBe(true);
        expect(decodeCompact(encodeCompact(r))).toEqual(r);
      }),
    );
  });

  it("encodes every valid record into a valid compact record", () => {
    fc.assert(
      fc.property(record, (r) => {
        expect(CompactRecordSchema.safeParse(encodeCompact(r)).success).toBe(true);
      }),
    );
  });

  it("compact JSON is shorter than full JSON", () => {
    fc.assert(
      fc.property(record, (r) => {
        expect(JSON.stringify(encodeCompact(r)).length).toBeLessThan(JSON.stringify(r).length);
      }),
    );
  });
});
