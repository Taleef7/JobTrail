import { describe, expect, it } from "vitest";
import {
  BINS,
  candidatePairs,
  excludedKeys,
  samplePairs,
  toCsv,
  type Pair,
} from "./matcher-pairs.ts";

const empty = { workPerformed: [], issuesFound: [], materials: [], followUps: [] };
const draft = (id: string, gold: object, checked: object | null) => ({
  id,
  gold: { ...empty, ...gold },
  meta: { checked: checked && { ...empty, ...checked } },
});

describe("candidatePairs (#114 held-out set)", () => {
  it("pairs checker output with gold within the same field only", () => {
    const pairs = candidatePairs([
      draft(
        "d-1",
        { materials: [{ name: "wax ring" }], workPerformed: ["Reset toilet"] },
        { materials: [{ name: "toilet wax ring" }], workPerformed: ["Reset the toilet bowl"] },
      ),
    ]);
    expect(pairs.map((p) => [p.kind, p.predicted, p.gold])).toEqual([
      ["material", "toilet wax ring", "wax ring"],
      ["statement", "Reset the toilet bowl", "Reset toilet"],
    ]);
  });

  it("drops pairs identical after normalization, duplicates, and unchecked drafts", () => {
    const pairs = candidatePairs([
      draft("d-1", { materials: [{ name: "Wire nut" }] }, { materials: [{ name: "wire nuts" }] }),
      draft("d-2", { followUps: ["Order part"] }, { followUps: ["order igniter"] }),
      draft("d-3", { followUps: ["Order part"] }, { followUps: ["Order igniter"] }),
      draft("d-4", { followUps: ["Order part"] }, null),
    ]);
    expect(pairs.map((p) => p.source)).toEqual(["d-2"]);
  });
});

describe("excludedKeys", () => {
  it("leaves out pairs already in another validation set, ignoring case", () => {
    const exclude = excludedKeys([
      'id,kind,predicted,gold,same\nmv-01,statement,"Order Igniter",order part,y\n',
    ]);
    const pairs = candidatePairs(
      [draft("d-2", { followUps: ["Order part", "Call back"] }, { followUps: ["order igniter"] })],
      exclude,
    );
    expect(pairs.map((p) => p.gold)).toEqual(["Call back"]);
  });
});

describe("pair identity is symmetric", () => {
  it("treats a reversed pair as the same pair, within a set and across sets", () => {
    const pairs = candidatePairs([
      draft(
        "d-1",
        { materials: [{ name: "deck board" }] },
        { materials: [{ name: "deck screws" }] },
      ),
      draft(
        "d-2",
        { materials: [{ name: "Deck Screws" }] },
        { materials: [{ name: "deck board" }] },
      ),
    ]);
    expect(pairs).toHaveLength(1);
    const exclude = excludedKeys([
      "id,kind,predicted,gold\nmv-01,material,deck board,deck screws\n",
    ]);
    expect(
      candidatePairs(
        [
          draft(
            "d-1",
            { materials: [{ name: "deck board" }] },
            { materials: [{ name: "deck screws" }] },
          ),
        ],
        exclude,
      ),
    ).toEqual([]);
  });
});

describe("samplePairs", () => {
  const pairs: Pair[] = Array.from({ length: 80 }, (_, i) => ({
    kind: i % 2 ? "material" : "statement",
    predicted: `p${i}`,
    gold: `g${i}`,
    source: `d-${i}`,
    dice: [0, 0.3, 0.6, 0.8][i % 4] as number,
  }));

  it("is reproducible for a seed and draws evenly from every score bin", () => {
    const a = samplePairs(pairs, 6, 114);
    expect(samplePairs(pairs, 6, 114)).toEqual(a);
    expect(samplePairs(pairs, 6, 1)).not.toEqual(a);
    for (const bin of BINS) expect(a.filter((p) => bin.test(p.dice))).toHaveLength(6);
  });
});

describe("toCsv", () => {
  it("quotes fields with commas or quotes and leaves label columns empty", () => {
    const csv = toCsv([
      { kind: "statement", predicted: 'Used two, no "three"', gold: "x", source: "d-1", dice: 0 },
    ]);
    expect(csv).toBe(
      'id,kind,predicted,gold,same,votes,source\nhv-01,statement,"Used two, no ""three""",x,,,d-1\n',
    );
  });
});
