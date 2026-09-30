import { describe, expect, it } from "vitest";
import { isMatch, matchOneToOne, normalizeTokens, similarity } from "./match.ts";

describe("normalizeTokens", () => {
  it("lowercases, splits on punctuation, drops stopwords and simple plurals", () => {
    expect(normalizeTokens("The PVC Trap-Kits!")).toEqual(["pvc", "trap", "kit"]);
  });

  it("singularizes -ies and -es endings but keeps short words and -ss", () => {
    expect(normalizeTokens("batteries boxes glass gas")).toEqual([
      "battery",
      "box",
      "glass",
      "gas",
    ]);
  });

  it("keeps the e of words that end in -e (fuses → fuse), strips -es after x/z/ch/sh/ss", () => {
    expect(normalizeTokens("fuses hoses cases")).toEqual(["fuse", "hose", "case"]);
    expect(normalizeTokens("boxes brushes batches glasses")).toEqual([
      "box",
      "brush",
      "batch",
      "glass",
    ]);
    expect(similarity("fuse", "fuses")).toBe(1);
  });

  it("drops possessive 's instead of leaving a stray 's' token", () => {
    expect(normalizeTokens("plumber's tape")).toEqual(["plumber", "tape"]);
    expect(normalizeTokens("customer’s sink")).toEqual(["customer", "sink"]);
  });

  it("returns an empty list for stopword-only text", () => {
    expect(normalizeTokens("the and of")).toEqual([]);
  });
});

describe("similarity (token-set Dice)", () => {
  it("is 1 for identical text after normalization", () => {
    expect(similarity("wire nuts", "Wire nut")).toBe(1);
  });

  it("is 0 for disjoint text", () => {
    expect(similarity("copper pipe", "light switch")).toBe(0);
  });

  it("is 2|A∩B| / (|A|+|B|)", () => {
    // {thermostat} vs {programmable, thermostat} → 2*1/(1+2)
    expect(similarity("thermostat", "programmable thermostat")).toBeCloseTo(2 / 3, 10);
  });

  it("is 0 when either side has no tokens", () => {
    expect(similarity("", "thermostat")).toBe(0);
  });
});

describe("matchOneToOne", () => {
  it("pairs each item at most once, best scores first", () => {
    const result = matchOneToOne(
      ["replaced p-trap", "used tape"],
      ["replaced kitchen p-trap", "plumber tape", "checked leaks"],
      0.5,
    );
    expect(result.pairs).toEqual([
      { pred: 0, gold: 0, score: expect.closeTo((2 * 3) / (3 + 4), 10) },
      { pred: 1, gold: 1, score: expect.closeTo((2 * 1) / (2 + 2), 10) },
    ]);
    expect(result.unmatchedPred).toEqual([]);
    expect(result.unmatchedGold).toEqual([2]);
  });

  it("resolves competition greedily by score", () => {
    // pred0 fits both golds; pred1 only fits gold0 weakly. Greedy gives gold0 to pred0.
    const result = matchOneToOne(["new thermostat", "thermostat wiring"], ["new thermostat"], 0.5);
    expect(result.pairs).toEqual([{ pred: 0, gold: 0, score: 1 }]);
    expect(result.unmatchedPred).toEqual([1]);
  });

  it("does not pair items below the threshold", () => {
    const result = matchOneToOne(["copper pipe"], ["pvc pipe"], 0.6);
    expect(result.pairs).toEqual([]);
    expect(result.unmatchedPred).toEqual([0]);
    expect(result.unmatchedGold).toEqual([0]);
  });

  it("handles empty lists", () => {
    expect(matchOneToOne([], ["x"], 0.5)).toEqual({
      pairs: [],
      unmatchedPred: [],
      unmatchedGold: [0],
    });
  });
});

describe("isMatch: synonyms (#114)", () => {
  it.each([
    ["material", "plumber's tape", "thread seal tape"],
    ["material", "teflon tape", "plumbers tape"],
    ["material", "GFCI receptacle", "GFCI outlet"],
    ["statement", "Recharged refrigerant", "Topped off refrigerant"],
    ["statement", "Sealed window", "Caulked around window"],
    ["statement", "Patched drywall", "Repaired hole in drywall"],
    ["statement", "Replaced thermostat", "Installed new thermostat on upstairs furnace"],
    ["statement", "Swapped out the P-trap", "Replaced P-trap"],
  ] as const)("%s: %s ≡ %s", (kind, a, b) => {
    expect(isMatch(a, b, kind)).toBe(true);
  });

  it("leaves grounding tokens alone: normalizeTokens does not apply synonyms", () => {
    expect(normalizeTokens("Replaced teflon tape")).toEqual(["replaced", "teflon", "tape"]);
  });
});

describe("isMatch: conflicting room, surface or pipe material (#114)", () => {
  it.each([
    ["statement", "Installed GFCI outlet in bathroom", "Installed GFCI outlet in kitchen"],
    ["statement", "Unclogged bathroom sink", "Unclogged kitchen sink"],
    ["statement", "Painted bedroom walls", "Painted bedroom ceiling"],
    ["material", "copper pipe", "PVC pipe"],
  ] as const)("%s: %s ≠ %s", (kind, a, b) => {
    expect(isMatch(a, b, kind)).toBe(false);
    expect(similarity(a, b, kind)).toBe(0);
  });

  it("treats spelling variants of one place as the same place", () => {
    expect(isMatch("Painted hall", "Painted hallway", "statement")).toBe(true);
    expect(isMatch("Regrouted master bath", "Regrouted master bathroom", "statement")).toBe(true);
  });

  it("does not fire when only one side names a room, or both share one", () => {
    expect(
      isMatch("Installed GFCI outlets", "Installed GFCI outlets in bathroom", "statement"),
    ).toBe(true);
    expect(isMatch("Painted walls and ceiling", "Painted ceiling", "statement")).toBe(true);
  });
});

describe("isMatch: material head nouns (#114)", () => {
  it.each([
    ["roofing cement", "roofing nail"],
    ["deck screws", "5/4 deck board"],
    ["carpet shampoo", "carpet deodorizer"],
    ["furnace thermostat", "furnace filter"],
  ])("%s ≠ %s (same modifier, different item)", (a, b) => {
    expect(isMatch(a, b, "material")).toBe(false);
  });

  it.each([
    ["furnace filter", "air filter"],
    ["breaker", "20 amp breaker"],
    ["2x4 studs", "2x4s"],
    ["PVC trap kit", "P-trap kit"],
  ])("%s ≡ %s (same head, or one name inside the other)", (a, b) => {
    expect(isMatch(a, b, "material")).toBe(true);
  });

  it("applies to materials only: statements often end on a place, not the item", () => {
    expect(
      isMatch("Replaced toilet flapper", "Fixed running toilet by replacing flapper", "statement"),
    ).toBe(true);
  });

  it("is used by matchOneToOne for materials", () => {
    const r = matchOneToOne(["roofing nails"], ["roofing cement"], 0.5, "material");
    expect(r.pairs).toEqual([]);
    expect(matchOneToOne(["roofing nails"], ["roofing cement"], 0.5).pairs).toHaveLength(1);
  });
});
