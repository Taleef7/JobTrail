// Raw model text → validated JobRecord. Validation is the Zod schema itself,
// so it can never drift from the contract (lesson from #99's review).
import type { z } from "zod";
import { CompactRecordSchema, decodeCompact } from "./codec.ts";
import { JobRecordSchema, type JobRecord } from "./schema.ts";
import { balancedObjectSpans, stripThinkBlocks } from "./text.ts";

export type ParseResult =
  { ok: true; value: JobRecord } | { ok: false; stage: "json" | "schema"; errors: string[] };

export interface ParseOptions {
  /** "compact" for fine-tuned models that emit short keys. Default "full". */
  format?: "full" | "compact";
}

function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".") || "(root)";
    const keys = "keys" in issue && Array.isArray(issue.keys) ? ` [${issue.keys.join(", ")}]` : "";
    return `${path}: ${issue.message}${keys}`;
  });
}

export function parseModelOutput(text: string, options: ParseOptions = {}): ParseResult {
  // The first balanced {…} span that parses as JSON is the record; prose around it
  // (including stray braces) is ignored.
  let value: unknown;
  let found = false;
  let lastError = "no JSON object found";
  for (const span of balancedObjectSpans(stripThinkBlocks(text))) {
    try {
      value = JSON.parse(span);
      found = true;
      break;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  if (!found) return { ok: false, stage: "json", errors: [lastError] };

  if (options.format === "compact") {
    const compact = CompactRecordSchema.safeParse(value);
    if (!compact.success)
      return { ok: false, stage: "schema", errors: describeIssues(compact.error) };
    return { ok: true, value: decodeCompact(compact.data) };
  }

  const full = JobRecordSchema.safeParse(value);
  if (!full.success) return { ok: false, stage: "schema", errors: describeIssues(full.error) };
  return { ok: true, value: full.data };
}
