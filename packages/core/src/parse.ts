// Raw model text → validated JobRecord. Validation is the Zod schema itself,
// so it can never drift from the contract (lesson from #99's review).
import type { z } from "zod";
import { CompactRecordSchema, decodeCompact } from "./codec";
import { JobRecordSchema, type JobRecord } from "./schema";
import { stripThinkBlocks } from "./text";

export type ParseResult =
  { ok: true; value: JobRecord } | { ok: false; stage: "json" | "schema"; errors: string[] };

export interface ParseOptions {
  /** "compact" for fine-tuned models that emit short keys. Default "full". */
  format?: "full" | "compact";
}

/** Pull the outermost {...} out of model text: drops <think> blocks, fences and prose. */
function extractJsonObject(text: string): string | null {
  const cleaned = stripThinkBlocks(text);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return start === -1 || end < start ? null : cleaned.slice(start, end + 1);
}

function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".") || "(root)";
    const keys = "keys" in issue && Array.isArray(issue.keys) ? ` [${issue.keys.join(", ")}]` : "";
    return `${path}: ${issue.message}${keys}`;
  });
}

export function parseModelOutput(text: string, options: ParseOptions = {}): ParseResult {
  const json = extractJsonObject(text);
  if (json === null) return { ok: false, stage: "json", errors: ["no JSON object found"] };

  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (e) {
    return { ok: false, stage: "json", errors: [e instanceof Error ? e.message : String(e)] };
  }

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
