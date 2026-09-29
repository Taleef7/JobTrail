# JobTrail v2 — Per-Issue Workflow

The legacy app died from unverified breadth: features were added faster than anyone checked them, and ✅ was ticked without evidence. Every v2 issue follows this lifecycle, **one issue at a time** (independent issues may run in parallel only if neither touches the other's files).

## 1. Pre-flight (before any code)

- Re-read the issue against the [design doc](superpowers/specs/2026-09-28-jobtrail-rebuild-design.md) and the current code on `main`.
- Ask: _Does this issue fully solve the underlying problem? Are the acceptance criteria observable? What's missing, ambiguous, or out of date given what earlier issues taught us?_
- If gaps exist, **edit the issue first** (scope + acceptance criteria), noting what changed and why.
- Post a **Pre-flight comment** on the issue:
  - Implementation plan (files/modules touched)
  - Test plan (which tests are written first; what manual checks)
  - **"Done looks like"** — exactly what will be observable in the live web app and/or the release APK afterwards

## 2. Before snapshot

Capture the current state so the change can be proven:

- Test suite results on `main` (counts).
- The live surface the issue affects: live URL screenshot, or Note 9S recording, or a failing test that demonstrates the missing behavior.
- Attach to the Pre-flight comment (or `evidence/<issue#>/before/`).

## 3. Implement (branch `issue-<#>-<slug>`)

- Test-first for logic: write the failing test, watch it fail, make it pass.
- Small commits. No unrelated changes.
- Update docs/CHANGELOG in the same PR when behavior changes.

## 4. Verify locally

- `pnpm -r typecheck && pnpm -r lint && pnpm -r test` (+ `uv run pytest` for `ml/`).
- Run the affected app (web dev server / Android dev build on the Note 9S) and walk through "Done looks like".

## 5. Ship

- PR referencing the issue with **`Refs #N`** — never `Closes #N`, which auto-closes the issue on merge _before_ live verification (learned in #62). CI green.
- Merge to `main` → Vercel production deploy (web) and/or release APK on GitHub Releases (mobile milestones).

## 6. After snapshot & close

- Verify **on the live surface**, not the dev build: live URL and/or the release APK installed on the Note 9S (and iPhone where relevant).
- Compare with the before snapshot; run the relevant `TEST_PROTOCOL.md` scenarios.
- Tick each acceptance criterion **with a link to its evidence**. Evidence for device claims lives in `evidence/<issue#>/after/` (benchmark JSON + short recording/screenshot).
- Post a **Verification comment** (before vs after, anything unexpected), then close the issue **manually**.
- `main` is protected, so after-evidence files (screenshots, benchmark JSON) are committed through a small follow-up PR titled `evidence: #N` touching only `evidence/<issue#>/`; the verification comment links them.
- Visual checks use `agent-browser` (headless Chrome): screenshot the live URL at desktop (1280px) and phone (375px) widths and look at them — text-only checks missed three layout bugs in #63.
- If anything doesn't match "Done looks like": don't close — fix, or file a follow-up issue and state the gap explicitly.

## Rules

- No ✅ without evidence. No numbers in README/web unless they come from committed results files.
- A failing or skipped check is reported as failing or skipped — never glossed.
- Evals before app polish.
