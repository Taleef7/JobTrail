import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseModelOutput } from "../parse.ts";
import { JobRecordSchema, type JobRecord } from "../schema.ts";
import { extractWithRules, LEGACY_BLOB, legacyExtract, legacyPatterns, toV2 } from "./rules.ts";

const fixtures = join(import.meta.dirname, "..", "..", "fixtures", "baseline");
const notes = JSON.parse(readFileSync(join(fixtures, "notes.json"), "utf8")) as {
  id: string;
  note: string;
}[];
const oracle = JSON.parse(readFileSync(join(fixtures, "legacy-outputs.json"), "utf8")) as {
  source: { blob: string };
  outputs: { id: string; output: unknown }[];
};
const noteById = new Map(notes.map((n) => [n.id, n.note]));

describe("port matches the unmodified legacy extractor", () => {
  it("oracle outputs came from the pinned legacy-v0 file", () => {
    expect(oracle.source.blob).toBe(LEGACY_BLOB);
    expect(oracle.outputs.map((o) => o.id)).toEqual(notes.map((n) => n.id));
  });

  it.each(oracle.outputs)("$id: identical raw output (incl. confidence)", ({ id, output }) => {
    // JSON round-trip drops undefined fields, exactly as the oracle file did.
    expect(JSON.parse(JSON.stringify(legacyExtract(noteById.get(id) ?? "")))).toEqual(output);
  });

  it("is stateless across calls (no leaked regex lastIndex)", () => {
    const note = noteById.get("rules-01") ?? "";
    expect(legacyExtract(note)).toEqual(legacyExtract(note));
  });
});

const r = (over: Partial<JobRecord>): JobRecord => ({
  jobType: null,
  workPerformed: [],
  issuesFound: [],
  materials: [],
  laborMinutes: null,
  customerApproved: null,
  followUps: [],
  ...over,
});

// Current behavior, pinned. These are NOT correct extractions — they are the floor.
const pinned: Record<string, JobRecord> = {
  "rules-01": r({
    jobType: "plumbing",
    workPerformed: ["Kitchen sink P-trap"], // verb stripped
    materials: [{ name: "PVC kit", quantity: 1, unit: "kit" }],
    laborMinutes: 55,
    customerApproved: true,
    followUps: ["Follow up if leak returns"],
  }),
  "rules-02": r({
    jobType: "electrical",
    workPerformed: ["Faulty wiring in outlet"],
    materials: [{ name: "New switch", quantity: 1, unit: null }], // quantity 1 is a default, not heard
  }),
  "rules-03": r({
    jobType: "plumbing",
    materials: [{ name: "PVC kit", quantity: 1, unit: "kit" }], // "2 boxes of screws" missed
  }),
  "rules-04": r({
    jobType: "hvac",
    workPerformed: ["The vents"], // "Swapped the thermostat" missed: unknown verb
    customerApproved: true, // "an hour and a half" → no laborMinutes
  }),
  "rules-05": r({
    jobType: "electrical",
    workPerformed: ["The breaker panel cover"],
    materials: [{ name: "Wire nuts", quantity: 3, unit: null }], // "2 hours" → no laborMinutes
  }),
  "rules-06": r({
    jobType: "hvac",
    customerApproved: true, // negation missed: "not sure the customer approved"
    followUps: ["Check back next week"],
  }),
  "rules-07": r({
    jobType: "plumbing", // "pipe" inside "repipe"; "didn't approve" → null, "patched" unknown
  }),
  "rules-08": r({
    jobType: "general", // legacy "inspection" has no v2 equivalent
    workPerformed: ["The smoke detectors"],
    materials: [{ name: "A scanner", quantity: 1, unit: "can" }], // substring unit; batteries missed
  }),
  "rules-09": r({
    jobType: "electrical", // a painting job: "light" wins by keyword order
    workPerformed: ["A light fixture"],
    customerApproved: true,
  }),
  "rules-10": r({
    laborMinutes: 2000, // violates v2 (max 1440): passed through, not repaired
  }),
};

describe("extractWithRules (schema v2 shape)", () => {
  it.each(notes)("$id: $why", ({ id, note }) => {
    expect(extractWithRules(note)).toEqual(pinned[id]);
  });

  it("output that violates v2 is passed through and scored as a schema failure", () => {
    const record = extractWithRules(noteById.get("rules-10") ?? "");
    expect(JobRecordSchema.safeParse(record).success).toBe(false);
    const parsed = parseModelOutput(JSON.stringify(record), { format: "full" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.stage).toBe("schema");
  });

  it("every other characterization output satisfies v2", () => {
    for (const { id, note } of notes.filter((n) => n.id !== "rules-10")) {
      expect(JobRecordSchema.safeParse(extractWithRules(note)).success, id).toBe(true);
    }
  });

  it("empty note → empty record", () => {
    expect(extractWithRules("")).toEqual(r({}));
  });
});

// The regexes exactly as written at legacy-v0 (CodeQL js/polynomial-redos flags
// the unanchored `(\d+)` ones: quadratic on long digit runs).
const ORIGINAL = {
  materials: [
    /used\s+(?:(\d+)\s+)?([^.,\n]{3,40}?)(?:\s*,|\s*\.|\s*and|$)/gi,
    /(\d+)\s+([A-Za-z\s]{3,30}?\s(?:kit|piece|unit|pack|roll|box|bag|set|bottle|tube|can))/gi,
  ],
  duration: [
    /took\s+(\d+)\s*(?:minutes?|mins?|min)/i,
    /(\d+)\s*(?:minutes?|mins?|min)\s*(?:of\s+)?(?:work|labor)/i,
    /(?:spent|took|worked)\s+(?:about\s+)?(\d+)\s*(?:minutes?|mins?|min)/i,
    /(\d+)\s*(?:minutes?|mins?|min)/i,
  ],
};

/** Every match a global scan finds: index plus all capture groups. */
const allMatches = (re: RegExp, s: string) =>
  [...s.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))].map(
    (m) => [m.index, ...m],
  );

describe("ReDoS hardening changes no result", () => {
  it("stays fast on pathological input (50k-digit run)", () => {
    for (const note of ["9".repeat(50_000), `9${" ".repeat(50_000)}x`, "9 ".repeat(25_000)]) {
      const start = performance.now();
      legacyExtract(note);
      expect(performance.now() - start).toBeLessThan(250);
    }
  });

  it("hardened regexes find exactly the legacy matches (property)", () => {
    const token = fc.constantFrom(..."9 1 0 min mins minutes of work labor kit box can took spent used about and a s".split(" "), " ", "\n", ".", ","); // prettier-ignore
    const patterns = legacyPatterns();
    fc.assert(
      fc.property(fc.array(token, { maxLength: 40 }), (tokens) => {
        const s = tokens.join("");
        for (const key of ["materials", "duration"] as const) {
          ORIGINAL[key].forEach((original, i) => {
            const hardened = patterns[key][i];
            if (!hardened) throw new Error(`missing ${key}[${i}]`);
            expect(allMatches(hardened, s)).toEqual(allMatches(original, s));
          });
        }
      }),
      { numRuns: 2000 },
    );
  });
});

describe("toV2", () => {
  it("renames fields, maps undefined → null, drops confidence and missingFields", () => {
    expect(
      toV2({
        workPerformed: ["A"],
        issuesFound: [],
        materials: [{ name: "Tape", quantity: 2 }],
        followUpNotes: ["F"],
        missingFields: ["customerApproval"],
        confidence: 0.9,
        jobType: "inspection",
        durationMinutes: 30,
      }),
    ).toEqual(
      r({
        jobType: "general",
        workPerformed: ["A"],
        materials: [{ name: "Tape", quantity: 2, unit: null }],
        laborMinutes: 30,
        followUps: ["F"],
      }),
    );
  });
});
