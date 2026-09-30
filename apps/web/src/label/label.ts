// Labeling tool logic (#71): the review queue, the edit form, and the reviewer's
// decisions. Pure functions, so the page (label/App.tsx) stays a thin view.
import { JOB_TYPES, JobRecordSchema, type JobRecord } from "@jobtrail/core";

export type Reason = "fidelity" | "panel" | "audit";
const REASONS: readonly string[] = ["fidelity", "panel", "audit"];

export interface ReviewItem {
  id: string;
  split: "test" | "dev";
  note: string;
  gold: JobRecord;
  tags: string[];
  flags: string[];
  panel: { model: string; problems: { field: string; issue: string }[] }[];
  reasons: Reason[];
}

/** Parse data/review/queue.jsonl; errors name the line and id. */
export function parseQueue(jsonl: string): ReviewItem[] {
  return jsonl
    .split(/\r?\n/)
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => line.trim() !== "")
    .map(({ line, n }) => {
      let item: ReviewItem;
      try {
        item = JSON.parse(line) as ReviewItem;
      } catch {
        throw new Error(`queue line ${n}: invalid JSON`);
      }
      const fail = (why: string) => new Error(`queue line ${n} (${item.id}): ${why}`);
      if (typeof item.id !== "string" || typeof item.note !== "string") throw fail("id/note");
      if (item.split !== "test" && item.split !== "dev") throw fail(`split ${String(item.split)}`);
      if (!Array.isArray(item.reasons) || item.reasons.some((r) => !REASONS.includes(r))) {
        throw fail(`reasons ${JSON.stringify(item.reasons)}`);
      }
      for (const k of ["tags", "flags", "panel"] as const) {
        if (!Array.isArray(item[k])) throw fail(`${k} must be an array`);
      }
      const gold = JobRecordSchema.safeParse(item.gold);
      if (!gold.success) {
        throw fail(gold.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "));
      }
      return { ...item, gold: gold.data };
    });
}

/**
 * Fingerprint of what the reviewer saw (note + draft key), FNV-1a 32-bit. A saved
 * decision only counts for a queue item with the same fingerprint, so rebuilding
 * the queue can't pair an old verdict with a changed draft.
 */
export function draftHash(item: Pick<ReviewItem, "note" | "gold">): string {
  const s = `${item.note}\n${JSON.stringify(item.gold)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------- edit form

export interface MaterialRow {
  name: string;
  quantity: string;
  unit: string;
}

export interface GoldForm {
  jobType: string;
  workPerformed: string;
  issuesFound: string;
  followUps: string;
  materials: MaterialRow[];
  laborMinutes: string;
  customerApproved: "true" | "false" | "null";
}

export const JOB_TYPE_OPTIONS = ["", ...JOB_TYPES] as const;

export function toForm(g: JobRecord): GoldForm {
  return {
    jobType: g.jobType ?? "",
    workPerformed: g.workPerformed.join("\n"),
    issuesFound: g.issuesFound.join("\n"),
    followUps: g.followUps.join("\n"),
    materials: g.materials.map((m) => ({
      name: m.name,
      quantity: m.quantity === null ? "" : String(m.quantity),
      unit: m.unit ?? "",
    })),
    laborMinutes: g.laborMinutes === null ? "" : String(g.laborMinutes),
    customerApproved: String(g.customerApproved) as GoldForm["customerApproved"],
  };
}

const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");

/** Plain decimals only: "0x10" or "1e2" become NaN, which the schema rejects. */
const numberOrNull = (s: string) => {
  const t = s.trim();
  if (t === "") return null;
  return /^\d+(?:\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
};

export type FormResult = { ok: true; gold: JobRecord } | { ok: false; errors: string[] };

/** Form back to a key, validated against schema v2; errors name the field. */
export function fromForm(f: GoldForm): FormResult {
  const candidate = {
    jobType: f.jobType === "" ? null : f.jobType,
    workPerformed: lines(f.workPerformed),
    issuesFound: lines(f.issuesFound),
    materials: f.materials
      // Only an entirely empty row is dropped; a row with a quantity but no name is an error.
      .filter((m) => [m.name, m.quantity, m.unit].some((v) => v.trim() !== ""))
      .map((m) => ({
        name: m.name.trim(),
        quantity: numberOrNull(m.quantity),
        unit: m.unit.trim() === "" ? null : m.unit.trim(),
      })),
    laborMinutes: numberOrNull(f.laborMinutes),
    customerApproved: f.customerApproved === "null" ? null : f.customerApproved === "true",
    followUps: lines(f.followUps),
  };
  const r = JobRecordSchema.safeParse(candidate);
  if (r.success) return { ok: true, gold: r.data };
  return { ok: false, errors: r.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`) };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** True when the form no longer shows the draft key (so Accept would discard edits). */
export function hasEdits(form: GoldForm, item: Pick<ReviewItem, "gold">): boolean {
  return !same(form, toForm(item.gold));
}

// ---------------------------------------------------------------- decisions

export type Action = "accept" | "edit" | "reject";
const ACTIONS: readonly string[] = ["accept", "edit", "reject"];

export interface Decision {
  id: string;
  split: ReviewItem["split"];
  action: Action;
  /** The verified key: the draft's for accept, the reviewer's for edit, null for reject. */
  gold: JobRecord | null;
  comment: string;
  reviewedAt: string;
  /** draftHash of the item as reviewed. */
  draftHash: string;
}

export type Decisions = Record<string, Decision>;

export function decide(
  d: Decisions,
  item: ReviewItem,
  action: Action,
  edited: JobRecord | null,
  comment: string,
  at: string,
): Decisions {
  const effective: Action = action === "edit" && same(edited, item.gold) ? "accept" : action;
  const gold = effective === "accept" ? item.gold : effective === "edit" ? edited : null;
  const decision: Decision = {
    id: item.id,
    split: item.split,
    action: effective,
    gold,
    comment,
    reviewedAt: at,
    draftHash: draftHash(item),
  };
  return { ...d, [item.id]: decision };
}

/**
 * Split saved decisions into those that apply to the current queue and those that
 * don't: `stale` (the item's note or key changed since) and `orphaned` (no longer
 * queued). The page shows both counts instead of silently dropping them.
 */
export function matchDecisions(items: ReviewItem[], saved: Decisions) {
  const byId = new Map(items.map((it) => [it.id, it]));
  const decisions: Decisions = {};
  const stale: string[] = [];
  const orphaned: string[] = [];
  for (const [id, x] of Object.entries(saved)) {
    const it = byId.get(id);
    if (!it) orphaned.push(id);
    else if (x.draftHash !== draftHash(it)) stale.push(id);
    else decisions[id] = x;
  }
  return { decisions, stale, orphaned };
}

/** One line per decided item, in queue order, with the draft key for the edit-rate report. */
export function decisionsJsonl(items: ReviewItem[], d: Decisions): string {
  return items
    .filter((it) => d[it.id])
    .map((it) => `${JSON.stringify({ ...d[it.id], draft: it.gold })}\n`)
    .join("");
}

export function progress(items: ReviewItem[], d: Decisions) {
  const counts = { done: 0, total: items.length, accept: 0, edit: 0, reject: 0 };
  for (const it of items) {
    const x = d[it.id];
    if (!x) continue;
    counts.done++;
    counts[x.action]++;
  }
  return counts;
}

/** Index of the first undecided item after `from`, wrapping; -1 when all are decided. */
export function nextPending(items: ReviewItem[], d: Decisions, from: number): number {
  for (let k = 1; k <= items.length; k++) {
    const i = (from + k) % items.length;
    const it = items[i];
    if (it && !d[it.id]) return i;
  }
  return -1;
}

// ---------------------------------------------------------------- storage

export const STORAGE_KEY = "jobtrail-label-v1";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

const isDecision = (x: unknown): x is Decision => {
  const d = x as Decision | null;
  return (
    !!d &&
    typeof d === "object" &&
    typeof d.id === "string" &&
    ACTIONS.includes(d.action) &&
    typeof d.draftHash === "string" &&
    typeof d.comment === "string"
  );
};

/** Well-formed decisions saved in this browser; empty when storage is blocked or corrupt. */
export function loadDecisions(storage: Storage): Decisions {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([id, x]) => isDecision(x) && x.id === id),
    ) as Decisions;
  } catch {
    return {};
  }
}

export function saveDecisions(storage: Storage, d: Decisions): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(d));
  } catch {
    // Private mode or blocked storage: the reviewer can still download the JSONL.
  }
}
