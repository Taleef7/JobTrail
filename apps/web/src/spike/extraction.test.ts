import { describe, expect, it } from "vitest";
import { SPIKE_SCHEMA, buildMessages, parseModelJson, validateSpikeExtraction } from "./extraction";

const valid = {
  jobType: "plumbing",
  workPerformed: ["Replaced kitchen sink P-trap"],
  issuesFound: [],
  materials: [{ name: "PVC trap kit", quantity: 1, unit: "kit" }],
  laborMinutes: 55,
  customerApproved: true,
  followUps: ["Check for leaks next visit"],
};

describe("buildMessages", () => {
  const note = "Swapped the P-trap, one PVC kit, took 55 minutes.";

  it("long shape has a system prompt containing the rules and the schema", () => {
    const [system, user] = buildMessages(note, "long");
    expect(system?.role).toBe("system");
    expect(system?.content).toContain("Do not invent");
    expect(system?.content).toContain('"laborMinutes"');
    expect(user).toEqual({ role: "user", content: note });
  });

  it("short shape is the note alone (what a fine-tuned model would receive)", () => {
    expect(buildMessages(note, "short")).toEqual([{ role: "user", content: note }]);
  });

  it("long prompt is several times larger than short (the prefill cost being measured)", () => {
    const size = (shape: "long" | "short") =>
      buildMessages(note, shape).reduce((n, m) => n + m.content.length, 0);
    expect(size("long")).toBeGreaterThan(size("short") * 5);
  });
});

describe("parseModelJson", () => {
  it("parses plain JSON", () => {
    expect(parseModelJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it("strips markdown fences and surrounding prose", () => {
    expect(parseModelJson('Sure!\n```json\n{"a":1}\n```\nDone.')).toEqual({
      ok: true,
      value: { a: 1 },
    });
  });

  it("strips a leading <think> block", () => {
    expect(parseModelJson('<think>hmm</think>\n{"a":2}')).toEqual({ ok: true, value: { a: 2 } });
  });

  it("reports malformed JSON instead of throwing", () => {
    const result = parseModelJson('{"a":');
    expect(result.ok).toBe(false);
  });
});

describe("validateSpikeExtraction", () => {
  it("accepts a well-formed record", () => {
    expect(validateSpikeExtraction(valid)).toEqual([]);
  });

  it("accepts nulls for unknown scalar fields", () => {
    expect(
      validateSpikeExtraction({
        ...valid,
        jobType: null,
        laborMinutes: null,
        customerApproved: null,
      }),
    ).toEqual([]);
  });

  it("rejects a non-object", () => {
    expect(validateSpikeExtraction("nope")).not.toEqual([]);
  });

  it("reports wrong types, unknown job types and missing fields by path", () => {
    const withoutFollowUps = Object.fromEntries(
      Object.entries(valid).filter(([key]) => key !== "followUps"),
    );
    const errors = validateSpikeExtraction({
      ...withoutFollowUps,
      jobType: "astronaut",
      laborMinutes: "55",
      materials: [{ name: 3, quantity: 1, unit: null }],
    });
    const paths = errors.map((e) => e.split(":")[0]);
    expect(paths).toEqual(
      expect.arrayContaining(["/jobType", "/laborMinutes", "/materials/0/name", "(root)"]),
    );
    expect(errors.join(" ")).toContain("followUps");
  });

  it("rejects fractional laborMinutes (schema says integer)", () => {
    expect(validateSpikeExtraction({ ...valid, laborMinutes: 1.5 })).not.toEqual([]);
  });

  it("rejects extra top-level properties (additionalProperties: false)", () => {
    expect(validateSpikeExtraction({ ...valid, confidence: 0.9 })).not.toEqual([]);
  });

  it("rejects extra properties inside materials", () => {
    const materials = [{ name: "PVC trap kit", quantity: 1, unit: "kit", cost: 12 }];
    expect(validateSpikeExtraction({ ...valid, materials })).not.toEqual([]);
  });

  it("the JSON Schema lists exactly the fields the validator checks", () => {
    expect(Object.keys(SPIKE_SCHEMA.properties).sort()).toEqual(Object.keys(valid).sort());
    expect([...SPIKE_SCHEMA.required].sort()).toEqual(Object.keys(valid).sort());
  });
});
