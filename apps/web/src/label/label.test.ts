import { describe, expect, it } from "vitest";
import type { JobRecord } from "@jobtrail/core";
import {
  decide,
  draftHash,
  hasEdits,
  matchDecisions,
  decisionsJsonl,
  fromForm,
  loadDecisions,
  nextPending,
  parseQueue,
  progress,
  saveDecisions,
  STORAGE_KEY,
  toForm,
  type Decisions,
  type ReviewItem,
} from "./label";

const gold: JobRecord = {
  jobType: "plumbing",
  workPerformed: ["Replaced kitchen sink P-trap"],
  issuesFound: [],
  materials: [
    { name: "PVC P-trap kit", quantity: 1, unit: "kit" },
    { name: "plumber's tape", quantity: null, unit: null },
  ],
  laborMinutes: 90,
  customerApproved: true,
  followUps: ["Check for leaks next week"],
};

const item = (id: string, over: Partial<ReviewItem> = {}): ReviewItem => ({
  id,
  split: "test",
  note: "Swapped the P-trap…",
  gold,
  tags: [],
  flags: [],
  panel: [],
  reasons: ["audit"],
  ...over,
});

describe("toForm / fromForm", () => {
  it("round-trips a key through the edit form", () => {
    expect(fromForm(toForm(gold))).toEqual({ ok: true, gold });
  });

  it("reads one list item per line, trimming and dropping blank lines and empty material rows", () => {
    const form = toForm(gold);
    form.workPerformed = "  Replaced P-trap \n\n Tightened slip nut ";
    form.materials.push({ name: " ", quantity: "", unit: "" });
    form.materials[1] = { name: "plumber's tape", quantity: "", unit: " " };
    const r = fromForm(form);
    expect(r.ok && r.gold.workPerformed).toEqual(["Replaced P-trap", "Tightened slip nut"]);
    expect(r.ok && r.gold.materials).toEqual(gold.materials);
  });

  it("maps blank scalars to null and reports invalid values by field", () => {
    const form = toForm(gold);
    form.jobType = "";
    form.laborMinutes = "";
    form.customerApproved = "null";
    const r = fromForm(form);
    expect(r.ok && [r.gold.jobType, r.gold.laborMinutes, r.gold.customerApproved]).toEqual([
      null,
      null,
      null,
    ]);

    form.laborMinutes = "1.5";
    form.materials[0] = { name: "PVC P-trap kit", quantity: "0", unit: "kit" };
    const bad = fromForm(form);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.errors.join(" | ")).toMatch(/laborMinutes/);
    expect(!bad.ok && bad.errors.join(" | ")).toMatch(/materials/);
  });
});

describe("decisions", () => {
  it("records accept with the original key, edit with the new key, reject with a reason", () => {
    let d: Decisions = {};
    d = decide(d, item("t-1"), "accept", null, "", "2026-09-30T00:00:00Z");
    const edited = { ...gold, laborMinutes: 60 };
    d = decide(d, item("t-2"), "edit", edited, "note says an hour", "2026-09-30T00:01:00Z");
    d = decide(d, item("t-3"), "reject", null, "ambiguous approval", "2026-09-30T00:02:00Z");
    expect(d["t-1"]).toMatchObject({ action: "accept", gold });
    expect(d["t-2"]).toMatchObject({ action: "edit", gold: edited, comment: "note says an hour" });
    expect(d["t-3"]).toMatchObject({ action: "reject", gold: null });
  });

  it("treats an edit that changes nothing as an accept", () => {
    const d = decide({}, item("t-1"), "edit", structuredClone(gold), "", "t");
    expect(d["t-1"]?.action).toBe("accept");
  });

  it("exports decided items as JSONL in queue order, with split and draft key", () => {
    const [t1, t2, d1] = [item("t-1"), item("t-2"), item("d-1", { split: "dev" })];
    const items = [t1, t2, d1];
    let d: Decisions = {};
    d = decide(d, d1, "reject", null, "x", "t2");
    d = decide(d, t1, "accept", null, "", "t1");
    const lines = decisionsJsonl(items, d)
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines.map((l) => [l.id, l.split, l.action])).toEqual([
      ["t-1", "test", "accept"],
      ["d-1", "dev", "reject"],
    ]);
    expect(lines[0]).toMatchObject({ gold, draft: gold, reviewedAt: "t1" });
  });

  it("counts progress and finds the next undecided item, wrapping around", () => {
    const [a, b, c] = [item("a"), item("b"), item("c")];
    const items = [a, b, c];
    const d = decide({}, b, "accept", null, "", "t");
    expect(progress(items, d)).toEqual({ done: 1, total: 3, accept: 1, edit: 0, reject: 0 });
    expect(nextPending(items, d, 0)).toBe(2);
    expect(nextPending(items, d, 2)).toBe(0);
    const all = decide(decide(d, a, "accept", null, "", "t"), c, "accept", null, "", "t");
    expect(nextPending(items, all, 0)).toBe(-1);
  });

  it("persists to storage and survives unavailable or corrupt storage", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    const d = decide({}, item("t-1"), "accept", null, "", "t");
    saveDecisions(storage, d);
    expect(loadDecisions(storage)).toEqual(d);
    mem.set(STORAGE_KEY, "{not json");
    expect(loadDecisions(storage)).toEqual({});
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadDecisions(broken)).toEqual({});
    expect(() => saveDecisions(broken, d)).not.toThrow();
  });
});

describe("parseQueue", () => {
  it("parses the queue JSONL and validates each key against schema v2", () => {
    const line = JSON.stringify(item("t-1", { reasons: ["fidelity", "panel"] }));
    expect(parseQueue(`${line}\n`)).toHaveLength(1);
    const bad = JSON.stringify({ ...item("t-2"), gold: { ...gold, laborMinutes: -5 } });
    expect(() => parseQueue(`${line}\n${bad}\n`)).toThrow(/line 2.*t-2/);
  });
});

describe("review fixes (#71 code review)", () => {
  it("hasEdits: Accept must not silently discard an edited form", () => {
    const it0 = item("t-1");
    const form = toForm(gold);
    expect(hasEdits(form, it0)).toBe(false);
    form.laborMinutes = "60";
    expect(hasEdits(form, it0)).toBe(true);
    // Reopening an already-edited item shows the edited key, which differs from the draft.
    expect(hasEdits(toForm({ ...gold, laborMinutes: 60 }), it0)).toBe(true);
  });

  it("keeps a material row that has a quantity but no name, so the schema reports it", () => {
    const form = toForm(gold);
    form.materials.push({ name: "", quantity: "2", unit: "" });
    const r = fromForm(form);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.join(" ")).toMatch(/materials\.2\.name/);
  });

  it("rejects hex or exponent numbers instead of reading 0x10 as 16", () => {
    const form = toForm(gold);
    form.laborMinutes = "0x10";
    expect(fromForm(form).ok).toBe(false);
    form.laborMinutes = "1e2";
    expect(fromForm(form).ok).toBe(false);
  });

  it("applies a saved decision only while the item's note and key are unchanged", () => {
    const it0 = item("t-1");
    const saved = decide({}, it0, "accept", null, "", "t");
    expect(saved["t-1"]?.draftHash).toBe(draftHash(it0));
    const changed = item("t-1", { gold: { ...gold, laborMinutes: 45 } });
    expect(matchDecisions([it0], saved)).toEqual({ decisions: saved, stale: [], orphaned: [] });
    expect(matchDecisions([changed], saved)).toEqual({
      decisions: {},
      stale: ["t-1"],
      orphaned: [],
    });
    expect(matchDecisions([item("t-9")], saved)).toEqual({
      decisions: {},
      stale: [],
      orphaned: ["t-1"],
    });
  });

  it("drops malformed saved decisions instead of corrupting the progress count", () => {
    const good = decide({}, item("t-1"), "accept", null, "", "t");
    const mem = new Map([
      [STORAGE_KEY, JSON.stringify({ ...good, "t-2": { id: "t-2", action: "maybe" }, x: 5 })],
    ]);
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: () => undefined };
    expect(loadDecisions(storage)).toEqual(good);
    mem.set(STORAGE_KEY, "[1,2]");
    expect(loadDecisions(storage)).toEqual({});
  });

  it("parseQueue names the line for bad JSON, split or reasons", () => {
    const ok = JSON.stringify(item("t-1"));
    expect(() => parseQueue(`${ok}\n{oops\n`)).toThrow(/line 2: invalid JSON/);
    const badSplit = JSON.stringify({ ...item("t-2"), split: "train" });
    expect(() => parseQueue(badSplit)).toThrow(/line 1 \(t-2\): split train/);
    const badReason = JSON.stringify({ ...item("t-3"), reasons: ["vibes"] });
    expect(() => parseQueue(badReason)).toThrow(/reasons/);
  });
});
