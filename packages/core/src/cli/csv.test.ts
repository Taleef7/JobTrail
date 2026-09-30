import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv.ts";
import { toCsv } from "./matcher-pairs.ts";

describe("parseCsv", () => {
  it("splits rows and fields, skipping blank lines and CRs", () => {
    expect(parseCsv("a,b,\r\n\r\nc,d,e\n")).toEqual([
      ["a", "b", ""],
      ["c", "d", "e"],
    ]);
  });

  it("keeps commas, doubled quotes and line breaks inside quoted fields", () => {
    expect(parseCsv('id,x\n1,"two, ""three""\nfour"\n')).toEqual([
      ["id", "x"],
      ["1", 'two, "three"\nfour'],
    ]);
  });

  it("reads back what toCsv writes, including embedded newlines", () => {
    const predicted = 'Used two,\nno "three"';
    const csv = toCsv([{ kind: "statement", predicted, gold: "x", source: "d-1", dice: 0 }]);
    expect(parseCsv(csv)[1]).toEqual(["hv-01", "statement", predicted, "x", "", "", "d-1"]);
  });
});
