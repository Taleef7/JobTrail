import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JobRecordSchema } from "./schema";

const dir = join(import.meta.dirname, "..", "fixtures", "schema");
const load = (verdict: "valid" | "invalid") =>
  readdirSync(join(dir, verdict)).map((f) => ({
    name: f,
    value: JSON.parse(readFileSync(join(dir, verdict, f), "utf8")) as unknown,
  }));

describe("JobRecordSchema (schema v2)", () => {
  it.each(load("valid"))("accepts valid fixture $name", ({ value }) => {
    expect(JobRecordSchema.safeParse(value).success).toBe(true);
  });

  it.each(load("invalid"))("rejects invalid fixture $name", ({ value }) => {
    expect(JobRecordSchema.safeParse(value).success).toBe(false);
  });

  it("has fixtures for both verdicts", () => {
    expect(load("valid").length).toBeGreaterThanOrEqual(5);
    expect(load("invalid").length).toBeGreaterThanOrEqual(10);
  });
});
