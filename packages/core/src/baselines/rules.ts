// The rule-based extractor from legacy v0, ported WITHOUT improvement. It is
// the honest floor every model must beat, and the app's zero-download fallback.
//
// legacyExtract() is a line-for-line port of RuleBasedAiProvider.extractJobFields
// at legacy-v0 (blob LEGACY_BLOB); rules.test.ts proves it reproduces the
// unmodified file's outputs (src/cli/legacy-rules-oracle.ts regenerates them).
// toV2() only reshapes the result into schema v2; it never repairs values.
//
// Known failure modes (pinned in rules.test.ts, fixtures/baseline/notes.json):
// - hours are never parsed: only "<n> min(utes)" is ("an hour and a half", "2 hours" → null)
// - negations are missed: "not sure the customer approved" → approved
// - work items keep the object but drop the verb, and only 9 verbs are known
//   ("Replaced X" → "X"; "Swapped"/"Patched"/"Rewired" → nothing)
// - units match by substring ("scanner" → "can"); no unit word → none
// - a material without a spoken number gets quantity 1
// - job type is the first keyword hit in a fixed order ("light" → electrical,
//   "pipe" inside "repipe" → plumbing); "inspection" has no v2 type → "general"
// - issuesFound is never extracted
// - out-of-range values (e.g. 2000 minutes) are emitted as-is and fail schema v2

import type { JobRecord, JobType } from "../schema.ts";

/** git blob of apps/mobile/src/ai/RuleBasedAiProvider.ts at tag legacy-v0. */
export const LEGACY_BLOB = "3d625ed573c25c6115e89ccc551bb0247424637d";
export const RULES_MODEL_ID = "rules-legacy-v0";

/** The legacy JobExtractionResult, as the legacy code produced it. */
export interface LegacyResult {
  jobType?: string;
  workPerformed: string[];
  issuesFound: string[];
  materials: { name: string; quantity: number; unit?: string | undefined }[];
  durationMinutes?: number;
  customerApproved?: boolean;
  followUpNotes: string[];
  confidence?: number;
  missingFields: string[];
}

export function legacyExtract(noteText: string): LegacyResult {
  const text = noteText.toLowerCase();
  const result: LegacyResult = {
    workPerformed: [],
    issuesFound: [],
    materials: [],
    followUpNotes: [],
    missingFields: [],
  };

  // --- Extract job type ---
  const jobTypes: Record<string, string[]> = {
    plumbing: ["plumb", "pipe", "sink", "drain", "faucet", "toilet", "p-trap", "pvc"],
    electrical: ["electr", "wiring", "outlet", "switch", "circuit", "breaker", "light"],
    hvac: ["hvac", "air condition", "furnace", "heater", "duct", "vent", "thermostat"],
    cleaning: ["clean", "wash", "sanitize", "dust", "mop", "vacuum"],
    inspection: ["inspect", "inspect", "assess", "check", "evaluate", "audit"],
    general: ["repair", "fix", "replace", "install", "maintain"],
  };

  for (const [type, keywords] of Object.entries(jobTypes)) {
    if (keywords.some((kw) => text.includes(kw))) {
      result.jobType = type;
      break;
    }
  }

  // --- Extract work performed ---
  const workPatterns = [
    /(?:replaced|fixed|repaired|installed|removed|adjusted|cleaned|checked|inspected)\s+([^.,\n]+)/gi,
  ];
  for (const pattern of workPatterns) {
    let match;
    while ((match = pattern.exec(noteText)) !== null) {
      const work = (match[1] ?? "").trim();
      if (work && !result.workPerformed.includes(work)) {
        result.workPerformed.push(capitalize(work));
      }
    }
  }

  // --- Extract materials ---
  const materialPatterns = [
    /used\s+(?:(\d+)\s+)?([^.,\n]{3,40}?)(?:\s*,|\s*\.|\s*and|$)/gi,
    /(\d+)\s+([A-Za-z\s]{3,30}?\s(?:kit|piece|unit|pack|roll|box|bag|set|bottle|tube|can))/gi,
  ];

  for (const pattern of materialPatterns) {
    let match;
    while ((match = pattern.exec(noteText)) !== null) {
      if (pattern === materialPatterns[0]) {
        const quantity = match[1] ? parseInt(match[1], 10) : 1;
        const name = (match[2] ?? "")
          .trim()
          .replace(/^(one|two|three|four|five)\s+/i, "")
          .trim();
        if (
          name.length > 2 &&
          !result.materials.some((m) => m.name.toLowerCase() === name.toLowerCase())
        ) {
          result.materials.push({ name: capitalize(name), quantity, unit: inferUnit(name) });
        }
      } else {
        const quantity = parseInt(match[1] ?? "", 10);
        const name = (match[2] ?? "").trim();
        if (!result.materials.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
          result.materials.push({ name: capitalize(name), quantity, unit: inferUnit(name) });
        }
      }
    }
  }

  // --- Extract duration ---
  const durationPatterns = [
    /took\s+(\d+)\s*(?:minutes?|mins?|min)/i,
    /(\d+)\s*(?:minutes?|mins?|min)\s*(?:of\s+)?(?:work|labor)/i,
    /(?:spent|took|worked)\s+(?:about\s+)?(\d+)\s*(?:minutes?|mins?|min)/i,
    /(\d+)\s*(?:minutes?|mins?|min)/i,
  ];

  for (const pattern of durationPatterns) {
    const match = pattern.exec(noteText);
    if (match) {
      result.durationMinutes = parseInt(match[1] ?? "", 10);
      break;
    }
  }

  // --- Extract customer approval ---
  if (/customer\s*(approved|ok|okay|signed off|accepted|confirmed)/i.test(text)) {
    result.customerApproved = true;
  } else if (/customer\s*(denied|rejected|not approved|refused)/i.test(text)) {
    result.customerApproved = false;
  }

  // --- Extract follow-up notes ---
  const followUpPatterns = [
    /follow[\s-]?up\s*(?:if|when|in case|should|to|on|for)?\s*([^.,\n]+)/gi,
    /check\s+(?:back|if|whether|on)\s+([^.,\n]+)/gi,
    /monitor\s+(?:for|if|whether)\s+([^.,\n]+)/gi,
  ];

  for (const pattern of followUpPatterns) {
    let match;
    while ((match = pattern.exec(noteText)) !== null) {
      const note = match[0].trim();
      if (note && !result.followUpNotes.includes(note)) {
        result.followUpNotes.push(capitalize(note));
      }
    }
  }

  // --- Compute confidence ---
  let confidence = 0.3;
  if (result.workPerformed.length > 0) confidence += 0.15;
  if (result.materials.length > 0) confidence += 0.15;
  if (result.durationMinutes !== undefined) confidence += 0.15;
  if (result.customerApproved !== undefined) confidence += 0.1;
  if (result.followUpNotes.length > 0) confidence += 0.05;
  if (result.jobType) confidence += 0.1;
  result.confidence = Math.min(confidence, 1);

  // --- Identify missing fields ---
  if (result.materials.length === 0) result.missingFields.push("materials");
  if (result.durationMinutes === undefined) result.missingFields.push("durationMinutes");
  if (result.customerApproved === undefined) result.missingFields.push("customerApproval");

  return result;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function inferUnit(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (lower.includes("kit")) return "kit";
  if (lower.includes("piece")) return "piece";
  if (lower.includes("pack")) return "pack";
  if (lower.includes("roll")) return "roll";
  if (lower.includes("box")) return "box";
  if (lower.includes("bag")) return "bag";
  if (lower.includes("bottle")) return "bottle";
  if (lower.includes("tube")) return "tube";
  if (lower.includes("can")) return "can";
  if (lower.includes("set")) return "set";
  return undefined;
}

const LEGACY_TO_V2_TYPE: Record<string, JobType> = {
  plumbing: "plumbing",
  electrical: "electrical",
  hvac: "hvac",
  cleaning: "cleaning",
  inspection: "general", // no inspection type in v2
  general: "general",
};

/** Reshape into schema v2. Values are carried over as-is, even when v2 rejects them. */
export function toV2(legacy: LegacyResult): JobRecord {
  return {
    jobType: legacy.jobType === undefined ? null : (LEGACY_TO_V2_TYPE[legacy.jobType] ?? null),
    workPerformed: legacy.workPerformed,
    issuesFound: legacy.issuesFound,
    materials: legacy.materials.map((m) => ({
      name: m.name,
      quantity: m.quantity,
      unit: m.unit ?? null,
    })),
    laborMinutes: legacy.durationMinutes ?? null,
    customerApproved: legacy.customerApproved ?? null,
    followUps: legacy.followUpNotes,
  };
}

export function extractWithRules(noteText: string): JobRecord {
  return toV2(legacyExtract(noteText));
}
