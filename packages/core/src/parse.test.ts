import { describe, expect, it } from "vitest";
import { parseModelOutput } from "./parse";

const full = {
  jobType: "plumbing",
  workPerformed: ["Replaced P-trap"],
  issuesFound: [],
  materials: [{ name: "PVC trap kit", quantity: 1, unit: "kit" }],
  laborMinutes: 90,
  customerApproved: true,
  followUps: [],
};
const compact = {
  t: "plumbing",
  w: ["Replaced P-trap"],
  i: [],
  m: [{ n: "PVC trap kit", q: 1, u: "kit" }],
  l: 90,
  a: true,
  f: [],
};

describe("parseModelOutput", () => {
  it("parses a clean full-format record", () => {
    expect(parseModelOutput(JSON.stringify(full))).toEqual({ ok: true, value: full });
  });

  it("strips markdown fences, <think> blocks and surrounding prose", () => {
    const raw = `<think>ok</think>Sure!\n\`\`\`json\n${JSON.stringify(full)}\n\`\`\`\nDone.`;
    expect(parseModelOutput(raw)).toEqual({ ok: true, value: full });
  });

  it("decodes compact output into the full record", () => {
    expect(parseModelOutput(JSON.stringify(compact), { format: "compact" })).toEqual({
      ok: true,
      value: full,
    });
  });

  it("reports unparseable JSON at the json stage", () => {
    const result = parseModelOutput('{"jobType": "plumbing", "workPerformed": [');
    expect(result).toMatchObject({ ok: false, stage: "json" });
  });

  it("reports text with no JSON object at the json stage", () => {
    expect(parseModelOutput("Okay, I understand.")).toMatchObject({ ok: false, stage: "json" });
  });

  it("reports schema violations with field paths", () => {
    const result = parseModelOutput(JSON.stringify({ ...full, laborMinutes: 1.5, extra: 1 }));
    expect(result).toMatchObject({ ok: false, stage: "schema" });
    if (!result.ok) {
      expect(result.errors.some((e) => e.startsWith("laborMinutes"))).toBe(true);
      expect(result.errors.join(" ")).toContain("extra");
    }
  });

  it("rejects full-format keys when compact is expected", () => {
    expect(parseModelOutput(JSON.stringify(full), { format: "compact" })).toMatchObject({
      ok: false,
      stage: "schema",
    });
  });
});
