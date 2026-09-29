// The JSON Schemas used for constrained decoding are generated from the Zod
// contract. This test fails if the committed files drift from the Zod source;
// `pnpm gen:schema` (vitest --mode update-schemas) rewrites them.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CompactRecordSchema } from "./codec.ts";
import { ScoreReportSchema } from "./report.ts";
import { JobRecordSchema } from "./schema.ts";

const outDir = join(import.meta.dirname, "..", "schema");
const files = {
  "schema.v2.json": JobRecordSchema,
  "schema.v2.compact.json": CompactRecordSchema,
  "score-report.v1.json": ScoreReportSchema,
};

const render = (schema: z.ZodType) =>
  `${JSON.stringify(z.toJSONSchema(schema, { target: "draft-2020-12" }), null, 2)}\n`;

describe("generated JSON Schemas", () => {
  it.each(Object.entries(files))("%s matches the Zod contract", (file, schema) => {
    const path = join(outDir, file);
    const expected = render(schema);
    if (import.meta.env.MODE === "update-schemas") writeFileSync(path, expected);
    expect(readFileSync(path, "utf8").replace(/\r\n/g, "\n")).toBe(expected);
  });
});
