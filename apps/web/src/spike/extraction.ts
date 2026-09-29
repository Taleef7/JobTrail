// Spike-local extraction contract for the web-runtime benchmark (#66).
// The real schema v2 lives in packages/core from #67; this is intentionally
// minimal and disposable.
import { stripThinkBlocks } from "@jobtrail/core/text";
import Ajv from "ajv";

export const JOB_TYPES = [
  "plumbing",
  "electrical",
  "hvac",
  "carpentry",
  "appliance",
  "cleaning",
  "painting",
  "roofing",
  "general",
] as const;

const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });
const stringList = { type: "array", items: { type: "string" } };

export const SPIKE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "jobType",
    "workPerformed",
    "issuesFound",
    "materials",
    "laborMinutes",
    "customerApproved",
    "followUps",
  ],
  properties: {
    jobType: nullable({ type: "string", enum: [...JOB_TYPES] }),
    workPerformed: stringList,
    issuesFound: stringList,
    materials: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "quantity", "unit"],
        properties: {
          name: { type: "string" },
          quantity: nullable({ type: "number" }),
          unit: nullable({ type: "string" }),
        },
      },
    },
    laborMinutes: nullable({ type: "integer" }),
    customerApproved: nullable({ type: "boolean" }),
    followUps: stringList,
  },
} as const;

const RULES = `You extract structured job records from a tradesperson's end-of-job note.
Rules:
- Return only JSON matching the schema below.
- Do not invent details. If something isn't mentioned, use null or an empty list.
- workPerformed: short action statements of completed work.
- followUps: future actions only; never repeat completed work.
- laborMinutes: total labor time in minutes (convert hours, e.g. "an hour and a half" = 90).
- customerApproved: true/false only if the note says so explicitly; otherwise null.
Schema:
${JSON.stringify(SPIKE_SCHEMA)}`;

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export function buildMessages(note: string, shape: "long" | "short"): ChatMessage[] {
  const user: ChatMessage = { role: "user", content: note };
  return shape === "long" ? [{ role: "system", content: RULES }, user] : [user];
}

export type ParseResult = { ok: true; value: unknown } | { ok: false; error: string };

export function parseModelJson(text: string): ParseResult {
  const withoutThinking = stripThinkBlocks(text);
  const start = withoutThinking.indexOf("{");
  const end = withoutThinking.lastIndexOf("}");
  if (start === -1 || end < start) return { ok: false, error: "no JSON object found" };
  try {
    return { ok: true, value: JSON.parse(withoutThinking.slice(start, end + 1)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Validate against the *declared* schema (integer, additionalProperties, required…)
// so the validator can never drift from what the model was constrained to.
const ajv = new Ajv({ allErrors: true, strict: false });
const validateSchema = ajv.compile(SPIKE_SCHEMA);

export function validateSpikeExtraction(value: unknown): string[] {
  if (validateSchema(value)) return [];
  return (validateSchema.errors ?? []).map(
    (e) => `${e.instancePath || "(root)"}: ${e.message ?? "invalid"}`,
  );
}

/** Hard-case notes: hours phrasing, negation, self-correction, supply-house trip. */
export const SPIKE_NOTES = [
  "Swapped out the P-trap under the kitchen sink, used one PVC trap kit and some plumber's tape. Took about an hour and a half. Customer signed off. Come back next week to check for leaks.",
  "Replaced the thermostat on the upstairs furnace, used two, no three, wire nuts. Had to run to the supply house for the thermostat. Two hours total. Customer didn't sign, wasn't home.",
];
