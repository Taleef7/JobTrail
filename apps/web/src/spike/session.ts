// Crash-safe spike sessions (#108). iOS kills a browser tab that exceeds its memory
// budget while a model loads, taking every in-memory result with it. So each cell
// is marked "attempted" in storage before it starts and "done" when it ends; a page
// that loads with an attempt still open records that cell as crashed. Kept pure
// (storage is injected) so it's testable.

import type { Backend } from "./result";

export const SESSION_KEY = "jobtrail-spike-session-v1";

export type Stage = "load" | "inference";

/** The subset of Web Storage this module needs (localStorage in the page). */
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface Attempt {
  model: string;
  /** The backend requested for this cell (the matrix key). */
  backend: Backend;
  /** What actually ran, once known after load (e.g. wasm-mt that fell back to wasm-st). */
  ran?: Backend;
  stage: Stage;
  since: string;
}

export interface CrashedLoad {
  model: string;
  backend: Backend;
  requestedBackend: Backend;
  status: "crashed";
  stage: Stage;
  reason: string;
  since: string;
}

export interface Session {
  startedAt: string;
  env: unknown;
  /** Load records as the page writes them, plus crashed ones added on recovery. */
  loads: unknown[];
  runs: unknown[];
  /** cellKey()s that finished or crashed; the next Run skips them. */
  done: string[];
  attempt: Attempt | null;
}

export const cellKey = (model: string, backend: Backend) => `${model}|${backend}`;

export function loadSession(store: Store, now: string): Session {
  const empty: Session = {
    startedAt: now,
    env: null,
    loads: [],
    runs: [],
    done: [],
    attempt: null,
  };
  try {
    const raw = store.getItem(SESSION_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (!Array.isArray(parsed.loads) || !Array.isArray(parsed.runs)) return empty;
    return { ...empty, ...parsed };
  } catch {
    return empty;
  }
}

/** False when storage refuses the write (quota, private mode); the run continues in memory. */
export function saveSession(store: Store, session: Session): boolean {
  try {
    store.setItem(SESSION_KEY, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

export function clearSession(store: Store): void {
  try {
    store.removeItem(SESSION_KEY);
  } catch {
    // nothing stored, nothing to clear
  }
}

export function beginCell(s: Session, model: string, backend: Backend, now: string): Session {
  return { ...s, attempt: { model, backend, stage: "load", since: now } };
}

/** Move the open attempt to `stage`; pass `ran` once the effective backend is known. */
export function setStage(s: Session, stage: Stage, ran?: Backend): Session {
  if (!s.attempt) return s;
  return { ...s, attempt: { ...s.attempt, stage, ...(ran ? { ran } : {}) } };
}

export function finishCell(s: Session): Session {
  if (!s.attempt) return s;
  const key = cellKey(s.attempt.model, s.attempt.backend);
  return { ...s, attempt: null, done: s.done.includes(key) ? s.done : [...s.done, key] };
}

/** Turn an attempt left open by a killed tab into a crashed load record. */
export function recoverCrash(s: Session): { session: Session; crashed: CrashedLoad | null } {
  const a = s.attempt;
  if (!a) return { session: s, crashed: null };
  const crashed: CrashedLoad = {
    model: a.model,
    backend: a.ran ?? a.backend,
    requestedBackend: a.backend,
    status: "crashed",
    stage: a.stage,
    reason: `tab was killed or reloaded during ${a.stage} (likely the browser's memory limit)`,
    since: a.since,
  };
  const session = finishCell({ ...s, loads: [...s.loads, crashed] });
  return { session, crashed };
}

export function pendingCells<C extends { model: string; backend: Backend }>(
  s: Session,
  cells: C[],
): C[] {
  return cells.filter((c) => !s.done.includes(cellKey(c.model, c.backend)));
}
