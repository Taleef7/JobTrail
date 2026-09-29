import { describe, expect, it } from "vitest";
import { matchOneToOne, normalizeTokens, similarity } from "./match.ts";

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
