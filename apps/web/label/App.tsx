// The owner's review of eval drafts (#71). Shows each queued note with its draft
// key, the fidelity flags and the model panel's findings; the reviewer accepts,
// edits or rejects. Decisions stay in this browser until downloaded.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import queueRaw from "../../../data/review/queue.jsonl?raw";
import {
  decide,
  decisionsJsonl,
  fromForm,
  hasEdits,
  JOB_TYPE_OPTIONS,
  loadDecisions,
  matchDecisions,
  nextPending,
  parseQueue,
  progress,
  saveDecisions,
  toForm,
  type Action,
  type Decision,
  type Decisions,
  type GoldForm,
  type ReviewItem,
} from "../src/label/label";

const items = parseQueue(queueRaw);
const storage = typeof localStorage === "undefined" ? null : localStorage;
const saved = storage ? loadDecisions(storage) : {};
// Saved decisions that no longer match the queue are kept in storage, never applied.
const { decisions: initial, stale, orphaned } = matchDecisions(items, saved);
const kept: Decisions = Object.fromEntries(
  [...stale, ...orphaned].flatMap((id) => (saved[id] ? [[id, saved[id]]] : [])),
);

const REASON_TEXT = {
  fidelity: "fidelity flag",
  panel: "panel questioned",
  audit: "random audit",
} as const;

export function LabelApp() {
  const [decisions, setDecisions] = useState<Decisions>(initial);
  const [index, setIndex] = useState(() => Math.max(0, nextPending(items, decisions, -1)));
  const [shortcuts, setShortcuts] = useState(true);
  const stats = useMemo(() => progress(items, decisions), [decisions]);
  const item = items[index];

  const onDecide = useCallback(
    (it: ReviewItem, action: Action, edited: ReviewItem["gold"] | null, comment: string) => {
      const next = decide(decisions, it, action, edited, comment, new Date().toISOString());
      setDecisions(next);
      if (storage) saveDecisions(storage, { ...kept, ...next });
      const n = nextPending(items, next, items.indexOf(it));
      if (n !== -1) setIndex(n);
    },
    [decisions],
  );

  const move = useCallback(
    (delta: number) => setIndex((i) => (i + delta + items.length) % items.length),
    [],
  );

  const download = () => {
    const blob = new Blob([decisionsJsonl(items, decisions)], { type: "application/jsonl" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `label-decisions-${new Date().toISOString().slice(0, 10)}.jsonl`;
    a.click();
    // Revoking synchronously can cancel the download in Safari.
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  if (!item) return <main className="label">The review queue is empty.</main>;

  return (
    <main className="label">
      <header>
        <p className="eyebrow">#71 · internal review tool, not the product</p>
        <h1>Check each answer key against its note</h1>
        <p className="lede">
          Does the note say exactly what the key says? <b>Accept</b> if it does. If a field is
          wrong, fix it and <b>Save edits</b>. <b>Reject</b> a note that's ambiguous. Rules:{" "}
          <a href="https://github.com/Taleef7/JobTrail/blob/main/data/LABELING.md">LABELING.md</a>.
          Progress is saved in this browser; download the decisions when you're done.
        </p>
        <div className="review-status" role="status">
          <progress max={stats.total} value={stats.done} />
          <span>
            {stats.done}/{stats.total} reviewed · {stats.accept} accepted · {stats.edit} edited ·{" "}
            {stats.reject} rejected
          </span>
          <button type="button" onClick={download} disabled={stats.done === 0}>
            Download decisions ({stats.done})
          </button>
        </div>
        {stale.length + orphaned.length > 0 && (
          <p className="warn-msg" role="status">
            {stale.length + orphaned.length} decision(s) saved in this browser no longer match the
            queue ({[...stale, ...orphaned].join(", ")}) and are not counted. Those notes need a
            fresh review.
          </p>
        )}
      </header>

      <nav className="jump">
        <button type="button" className="ghost" onClick={() => move(-1)} aria-label="Previous">
          ← K
        </button>
        <select
          aria-label="Jump to note"
          value={index}
          onChange={(e) => setIndex(Number(e.target.value))}
        >
          {items.map((it, i) => (
            <option key={it.id} value={i}>
              {decisions[it.id] ? "✓" : "·"} {it.id} ({it.split}) — {it.reasons.join(", ")}
            </option>
          ))}
        </select>
        <button type="button" className="ghost" onClick={() => move(1)} aria-label="Next">
          J →
        </button>
        <label className="toggle">
          <input
            type="checkbox"
            checked={shortcuts}
            onChange={(e) => setShortcuts(e.target.checked)}
          />
          Keyboard shortcuts
        </label>
      </nav>

      {/* Keyed by id: the edit form starts fresh for every note. */}
      <Review
        key={item.id}
        item={item}
        decision={decisions[item.id]}
        shortcuts={shortcuts}
        onDecide={onDecide}
        onMove={move}
      />

      {stats.done === stats.total && (
        <p className="done-msg" role="status">
          All {stats.total} reviewed. Press <b>Download decisions</b> and send the file.
        </p>
      )}
    </main>
  );
}

interface ReviewProps {
  item: ReviewItem;
  decision: Decision | undefined;
  shortcuts: boolean;
  onDecide: (
    item: ReviewItem,
    action: Action,
    edited: ReviewItem["gold"] | null,
    comment: string,
  ) => void;
  onMove: (delta: number) => void;
}

function Review({ item, decision, shortcuts, onDecide, onMove }: ReviewProps) {
  const [form, setForm] = useState<GoldForm>(() => toForm(decision?.gold ?? item.gold));
  const [comment, setComment] = useState(decision?.comment ?? "");
  const [errors, setErrors] = useState<string[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);

  // A new note has loaded: move focus to it so screen readers announce it.
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);

  const record = useCallback(
    (action: Action) => {
      if (action === "accept" && hasEdits(form, item)) {
        return setErrors([
          "You changed the key. Press Save edits to keep the changes, or Reset to the draft key first.",
        ]);
      }
      let edited = null;
      if (action === "edit") {
        const r = fromForm(form);
        if (!r.ok) return setErrors(r.errors);
        edited = r.gold;
      }
      if (action === "reject" && comment.trim() === "") {
        return setErrors(["Say why in the comment box before rejecting."]);
      }
      setErrors([]);
      onDecide(item, action, edited, comment.trim());
    },
    [comment, form, item, onDecide],
  );

  useEffect(() => {
    if (!shortcuts) return;
    const onKey = (e: KeyboardEvent) => {
      // A held key must not decide a run of unseen notes.
      if (e.repeat) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        record("edit");
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select")) {
        if (e.key === "Escape") target.blur();
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "a") record("accept");
      else if (k === "s") record("edit");
      else if (k === "r") record("reject");
      else if (k === "j" || e.key === "ArrowRight") onMove(1);
      else if (k === "k" || e.key === "ArrowLeft") onMove(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onMove, record, shortcuts]);

  const set = <K extends keyof GoldForm>(key: K, value: GoldForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const setMaterial = (i: number, key: "name" | "quantity" | "unit", value: string) =>
    set(
      "materials",
      form.materials.map((m, j) => (j === i ? { ...m, [key]: value } : m)),
    );

  return (
    <div className="grid">
      <section aria-labelledby="note-h" className="card">
        <h2 id="note-h" ref={heading} tabIndex={-1}>
          {item.id} <span className="muted">· {item.split}</span>
        </h2>
        <p className="chips">
          {item.reasons.map((r) => (
            <span key={r} className={`chip ${r}`}>
              {REASON_TEXT[r]}
            </span>
          ))}
          {item.tags.map((t) => (
            <span key={t} className="chip tag">
              {t}
            </span>
          ))}
        </p>
        <blockquote className="note">{item.note}</blockquote>
        {item.flags.length > 0 && (
          <>
            <h3>Fidelity flags (automatic checks)</h3>
            <ul className="findings">
              {item.flags.map((f) => (
                <li key={f}>
                  <code>{f}</code>
                </li>
              ))}
            </ul>
          </>
        )}
        {item.panel.length > 0 && (
          <>
            <h3>Model panel findings</h3>
            <ul className="findings">
              {item.panel.flatMap((p) =>
                p.problems.map((x, i) => (
                  <li key={`${p.model}-${i}`}>
                    <b>{p.model}</b> · <code>{x.field}</code>: {x.issue}
                  </li>
                )),
              )}
            </ul>
          </>
        )}
        {item.reasons.includes("audit") && (
          <p className="muted">
            Picked at random from notes nothing flagged. Check it as carefully as the others.
          </p>
        )}
      </section>

      <section aria-labelledby="key-h" className="card">
        <h2 id="key-h">
          Answer key{" "}
          {decision && (
            <span className={`chip ${decision.action}`}>
              {decision.action === "edit" ? "edited" : `${decision.action}ed`}
            </span>
          )}
        </h2>
        <label>
          Job type
          <select value={form.jobType} onChange={(e) => set("jobType", e.target.value)}>
            {JOB_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t === "" ? "(no clue in note)" : t}
              </option>
            ))}
          </select>
        </label>
        {(
          [
            ["workPerformed", "Work performed"],
            ["issuesFound", "Issues found"],
            ["followUps", "Follow-ups"],
          ] as const
        ).map(([key, text]) => (
          <label key={key}>
            {text} <span className="muted">(one per line)</span>
            <textarea
              rows={Math.max(2, form[key].split("\n").length + 1)}
              value={form[key]}
              onChange={(e) => set(key, e.target.value)}
            />
          </label>
        ))}
        <fieldset>
          <legend>Materials</legend>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {form.materials.map((m, i) => (
                <tr key={i}>
                  <td>
                    <input
                      aria-label={`Material ${i + 1} name`}
                      value={m.name}
                      onChange={(e) => setMaterial(i, "name", e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Material ${i + 1} quantity`}
                      inputMode="decimal"
                      value={m.quantity}
                      placeholder="none said"
                      onChange={(e) => setMaterial(i, "quantity", e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Material ${i + 1} unit`}
                      value={m.unit}
                      placeholder="none"
                      onChange={(e) => setMaterial(i, "unit", e.target.value)}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ghost"
                      aria-label={`Remove material ${i + 1}`}
                      onClick={() =>
                        set(
                          "materials",
                          form.materials.filter((_, j) => j !== i),
                        )
                      }
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className="ghost"
            onClick={() =>
              set("materials", [...form.materials, { name: "", quantity: "", unit: "" }])
            }
          >
            + Add material
          </button>
        </fieldset>
        <div className="row">
          <label>
            Labor (minutes)
            <input
              inputMode="numeric"
              value={form.laborMinutes}
              placeholder="not said"
              onChange={(e) => set("laborMinutes", e.target.value)}
            />
          </label>
          <label>
            Customer approved
            <select
              value={form.customerApproved}
              onChange={(e) =>
                set("customerApproved", e.target.value as GoldForm["customerApproved"])
              }
            >
              <option value="true">yes, explicitly</option>
              <option value="false">no, explicitly</option>
              <option value="null">not said / unsure</option>
            </select>
          </label>
        </div>
        <label>
          Comment <span className="muted">(required to reject)</span>
          <input value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
        {errors.length > 0 && (
          <ul className="errors" role="alert">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <div className="actions">
          <button type="button" onClick={() => record("accept")}>
            Accept key <kbd>A</kbd>
          </button>
          <button type="button" className="secondary" onClick={() => record("edit")}>
            Save edits <kbd>S</kbd>
          </button>
          <button type="button" className="danger" onClick={() => record("reject")}>
            Reject note <kbd>R</kbd>
          </button>
          <button
            type="button"
            className="ghost"
            disabled={!hasEdits(form, item)}
            onClick={() => {
              setForm(toForm(item.gold));
              setErrors([]);
            }}
          >
            Reset to draft key
          </button>
        </div>
      </section>
    </div>
  );
}
