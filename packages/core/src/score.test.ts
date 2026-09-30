import { describe, expect, it } from "vitest";
import { encodeCompact } from "./codec.ts";
import type { JobRecord } from "./schema.ts";
import { scoreRecord, scoreRun, type GoldRecord, type PredictionRecord } from "./score.ts";

const NOTE =
  "Swapped the P-trap under the kitchen sink, used 1 PVC trap kit. Took an hour and a half. Customer signed off. Check for leaks next week.";

const goldRecord: JobRecord = {
  jobType: "plumbing",
  workPerformed: ["Replaced kitchen sink P-trap"],
  issuesFound: [],
  materials: [{ name: "PVC trap kit", quantity: 1, unit: "kit" }],
  laborMinutes: 90,
  customerApproved: true,
  followUps: ["Check for leaks next week"],
};

const gold = (over: Partial<GoldRecord> = {}): GoldRecord => ({
  id: "g1",
  note: NOTE,
  gold: goldRecord,
  source: "synthetic",
  tags: ["hours-phrasing"],
  ...over,
});

const pred = (record: unknown, over: Partial<PredictionRecord> = {}): PredictionRecord => ({
  id: "g1",
  raw: typeof record === "string" ? record : JSON.stringify(record),
  ...over,
});

describe("scoreRecord", () => {
  it("scores a perfect prediction as zero-edit with nothing ungrounded", () => {
    const s = scoreRecord(gold(), pred(goldRecord));
    expect(s.parse).toBe("ok");
    expect(s.scalars).toEqual({ jobType: true, laborMinutes: true, customerApproved: true });
    expect(s.lists.workPerformed).toEqual({ tp: 1, fp: 0, fn: 0 });
    expect(s.lists.followUps).toEqual({ tp: 1, fp: 0, fn: 0 });
    expect(s.materials).toEqual({ tp: 1, fp: 0, fn: 0, quantityCorrect: 1, unitCorrect: 1 });
    expect(s.grounding).toEqual({ checked: 2, ungrounded: 0 });
    expect(s.zeroEdit).toBe(true);
  });

  it("marks a wrong scalar and loses zero-edit", () => {
    const s = scoreRecord(gold(), pred({ ...goldRecord, laborMinutes: 120 }));
    expect(s.scalars.laborMinutes).toBe(false);
    expect(s.zeroEdit).toBe(false);
  });

  it("counts extra and missing materials; flags an ungrounded extra", () => {
    const s = scoreRecord(
      gold(),
      pred({
        ...goldRecord,
        materials: [...goldRecord.materials, { name: "Bucket", quantity: 2, unit: null }],
      }),
    );
    expect(s.materials).toMatchObject({ tp: 1, fp: 1, fn: 0 });
    // "bucket" and "2" are not in the note → 2 of 4 checks ungrounded
    expect(s.grounding).toEqual({ checked: 4, ungrounded: 2 });
    expect(s.zeroEdit).toBe(false);
  });

  it("keeps the match but marks a wrong quantity", () => {
    const s = scoreRecord(
      gold(),
      pred({ ...goldRecord, materials: [{ name: "PVC trap kit", quantity: 3, unit: "kit" }] }),
    );
    expect(s.materials).toEqual({ tp: 1, fp: 0, fn: 0, quantityCorrect: 0, unitCorrect: 1 });
    expect(s.zeroEdit).toBe(false);
  });

  it("scores unparseable output as fully wrong (never dropped)", () => {
    const s = scoreRecord(gold(), pred("Okay, I understand."));
    expect(s.parse).toBe("json");
    expect(s.scalars).toEqual({ jobType: false, laborMinutes: false, customerApproved: false });
    expect(s.lists.workPerformed).toEqual({ tp: 0, fp: 0, fn: 1 });
    expect(s.materials).toEqual({ tp: 0, fp: 0, fn: 1, quantityCorrect: 0, unitCorrect: 0 });
    expect(s.zeroEdit).toBe(false);
  });

  it("scores schema-invalid output as fully wrong at the schema stage", () => {
    const s = scoreRecord(gold(), pred({ ...goldRecord, laborMinutes: 1.5 }));
    expect(s.parse).toBe("schema");
    expect(s.zeroEdit).toBe(false);
  });

  it("scores a missing prediction as fully wrong", () => {
    const s = scoreRecord(gold(), undefined);
    expect(s.parse).toBe("missing");
    expect(s.lists.followUps).toEqual({ tp: 0, fp: 0, fn: 1 });
  });

  it("scores compact-format predictions the same as full", () => {
    const s = scoreRecord(gold(), pred(encodeCompact(goldRecord), { format: "compact" }));
    expect(s.zeroEdit).toBe(true);
  });
});

describe("scoreRun", () => {
  it("aggregates micro P/R/F1, rates and accuracies", () => {
    const g2: GoldRecord = { ...gold({ id: "g2", source: "role-played-owner", tags: [] }) };
    const report = scoreRun(
      [gold(), g2],
      [
        pred(goldRecord),
        pred(
          {
            ...goldRecord,
            laborMinutes: 60,
            materials: [...goldRecord.materials, { name: "Bucket", quantity: 2, unit: null }],
          },
          { id: "g2" },
        ),
      ],
      { run: "unit" },
    );
    const m = report.overall;
    expect(m.n).toBe(2);
    expect(m.parseRate).toBe(1);
    expect(m.schemaValidRate).toBe(1);
    expect(m.zeroEditRate).toBe(0.5);
    expect(m.laborMinutesAccuracy).toBe(0.5);
    expect(m.jobTypeAccuracy).toBe(1);
    // materials: tp 2, fp 1, fn 0 → P 2/3, R 1, F1 0.8
    expect(m.materials.precision).toBeCloseTo(2 / 3, 10);
    expect(m.materials.recall).toBe(1);
    expect(m.materials.f1).toBeCloseTo(0.8, 10);
    expect(m.materials.quantityAccuracy).toBe(1);
    // grounding: record1 2 checks, record2 4 checks with 2 ungrounded → 2/6
    expect(m.hallucinationRate).toBeCloseTo(2 / 6, 10);
  });

  it("slices by source and by tag with their own sample sizes", () => {
    const report = scoreRun(
      [gold(), gold({ id: "g2", source: "role-played-owner", tags: [] })],
      [pred(goldRecord), pred("nope", { id: "g2" })],
      { run: "unit" },
    );
    expect(report.bySource.synthetic).toMatchObject({ n: 1, zeroEditRate: 1 });
    expect(report.bySource["role-played-owner"]).toMatchObject({
      n: 1,
      zeroEditRate: 0,
      parseRate: 0,
    });
    expect(report.byTag["hours-phrasing"]).toMatchObject({ n: 1 });
  });

  it("treats empty-vs-empty lists as perfect precision and recall", () => {
    const report = scoreRun([gold()], [pred(goldRecord)], { run: "unit" });
    expect(report.overall.issuesFound).toEqual({ precision: 1, recall: 1, f1: 1 });
  });

  it("reports nearest-rank latency percentiles when timings exist", () => {
    const ids = ["a", "b", "c", "d"];
    const report = scoreRun(
      ids.map((id) => gold({ id })),
      ids.map((id, i) => pred(goldRecord, { id, timings: { wallMs: (i + 1) * 100 } })),
      { run: "unit" },
    );
    expect(report.overall.latency).toEqual({ p50WallMs: 200, p90WallMs: 400 });
  });

  it("reports null latency when no timings exist", () => {
    expect(scoreRun([gold()], [pred(goldRecord)], { run: "unit" }).overall.latency).toBeNull();
  });

  it("ignores predictions whose id has no gold record, and says so", () => {
    const report = scoreRun([gold()], [pred(goldRecord), pred(goldRecord, { id: "stray" })], {
      run: "unit",
    });
    expect(report.overall.n).toBe(1);
    expect(report.unmatchedPredictionIds).toEqual(["stray"]);
  });

  it("rejects matcher thresholds outside (0, 1]", () => {
    for (const threshold of [0, -0.1, 1.5, Number.NaN]) {
      expect(() => scoreRun([gold()], [pred(goldRecord)], { run: "unit", threshold })).toThrow(
        /threshold/,
      );
    }
    expect(() =>
      scoreRun([gold()], [pred(goldRecord)], { run: "unit", threshold: 1 }),
    ).not.toThrow();
  });

  it("rejects duplicate prediction ids instead of silently keeping the last", () => {
    expect(() => scoreRun([gold()], [pred(goldRecord), pred(goldRecord)], { run: "unit" })).toThrow(
      /duplicate prediction id.*g1/,
    );
  });

  it("rejects duplicate gold ids", () => {
    expect(() => scoreRun([gold(), gold()], [pred(goldRecord)], { run: "unit" })).toThrow(
      /duplicate gold id.*g1/,
    );
  });
});

describe("grounding: quantity 1 said as an article", () => {
  type Material = JobRecord["materials"][number];
  const groundingFor = (note: string, materials: Material[]) =>
    scoreRecord(gold({ note }), pred({ ...goldRecord, materials })).grounding;
  const WAX_NOTE = "Pulled the toilet and set it back on a new wax ring. Took 40 minutes.";

  it("grounds 1 when 'a' introduces the material", () => {
    expect(groundingFor(WAX_NOTE, [{ name: "Wax ring", quantity: 1, unit: null }])).toEqual({
      checked: 2,
      ungrounded: 0,
    });
  });

  it("grounds 1 for 'an' too", () => {
    const note = "Installed an outdoor GFCI outlet by the patio.";
    expect(groundingFor(note, [{ name: "GFCI outlet", quantity: 1, unit: null }])).toEqual({
      checked: 2,
      ungrounded: 0,
    });
  });

  it("still flags an invented 1 for a material no article introduces", () => {
    const materials = [
      { name: "Wax ring", quantity: 1, unit: null },
      { name: "Toilet bolts", quantity: 1, unit: null },
    ];
    // "toilet" is in the note (name grounded) but only "the toilet": the 1 is invented
    expect(groundingFor(WAX_NOTE, materials)).toEqual({ checked: 4, ungrounded: 1 });
  });

  it("does not read 'a few' as 1", () => {
    const note = "Swapped the light fixture using a few wire nuts.";
    expect(groundingFor(note, [{ name: "Wire nuts", quantity: 1, unit: null }])).toEqual({
      checked: 2,
      ungrounded: 1,
    });
  });

  it("grounds 1 through the unit: 'a 50 foot roll of Romex'", () => {
    const note = "Ran a 50 foot roll of Romex to the garage.";
    expect(groundingFor(note, [{ name: "Romex", quantity: 1, unit: "roll" }])).toEqual({
      checked: 2,
      ungrounded: 0,
    });
  });

  it("does not let an article reach across a comma", () => {
    const note = "Checked a breaker, wire nuts were loose so I tightened them.";
    expect(groundingFor(note, [{ name: "Wire nuts", quantity: 1, unit: null }])).toEqual({
      checked: 2,
      ungrounded: 1,
    });
  });

  it("does not stretch past three words after the article", () => {
    const note = "Found a leak near the old copper supply pipe under the sink.";
    expect(groundingFor(note, [{ name: "Supply pipe", quantity: 1, unit: null }])).toEqual({
      checked: 2,
      ungrounded: 1,
    });
  });
});
