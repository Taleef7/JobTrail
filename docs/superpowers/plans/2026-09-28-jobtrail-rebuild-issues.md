# JobTrail v2 — Issue Drafts

Source design: `docs/superpowers/specs/2026-09-28-jobtrail-rebuild-design.md`
Status: **draft — not yet created on GitHub.**

## Conventions

**Milestones:** `M0 Reset & de-risk` · `M1 Eval foundation` · `M2 Model` · `M3 Mobile MVP` · `M4 Web demo & evidence` · `M5 Launch & outreach`

**Labels:** `area:repo` `area:core` `area:data` `area:ml` `area:mobile` `area:web` `area:docs` `outreach` · `type:spike` `type:feature` `type:chore` `type:eval` · `needs-device` (acceptance requires evidence from a physical device)

**Definition of done (every issue):**
- Acceptance criteria met *with evidence linked in the closing comment* (test run, results JSON, screenshot/recording).
- `needs-device` issues: benchmark JSON + short screen recording from the named device committed under `evidence/<issue#>/`.
- No claim in README/docs that isn't backed by a committed artifact.
- CI green.

Device shorthand: **Note 9S** = Redmi Note 9S 6 GB (Snapdragon 720G, CPU-only), the minimum-spec device. **iPhone** = iPhone 16 Pro.

**Budget rule:** free tiers first (Gemini API free tier, Kaggle/Colab free GPUs, HF Hub, Vercel Hobby). Any script calling a cloud model must throttle to free-tier limits, checkpoint/resume, and log token usage. Paid spend only with owner approval, capped at a few dollars.

---

## M0 — Reset & de-risk

### 1. Archive legacy app and reset the repository
**Labels:** `area:repo` `type:chore` · **Depends on:** —

**Context.** The legacy app (Expo 54, Firebase sync, cascade AI) was audited on 2026-09-28: core flow broken, sync engine broken, on-device claims unverified (see design §1). Its public docs contain claims a reviewer can disprove, which is a portfolio liability.

**Scope**
- Tag current `origin/main` as `legacy-v0` and push the tag.
- Single "reset" commit on `main` removing `apps/mobile`, legacy docs (`PLAN.md`, `AGENT_HANDOFF.md`, `JobTrail_CODEX_PROMPT.md`, `DEPLOYMENT.md`, 2026-06-17 spec), `coverage/`, stray screenshots, `.playwright-mcp/`, `.opencode/`.
- Keep: `LICENSE`, `.editorconfig`, `.github/` (to be rewritten in #2), the new spec + this issue file.
- Close all 25 Dependabot PRs with a comment pointing to the rebuild.
- Close legacy issues 3, 5, 6, 8, 10, 12, 13, 17, 19 with a short note, and close the old milestones `v0.2.0 — Polish` and `v0.3.0 — Local LLM PoC`.
- Delete stale local branch `feat/local-llm`; discard unpushed commit `a556293`.
- Replace README with an honest stub: what v2 is, "rebuild in progress", link to the design doc and `legacy-v0`.
- Update repo description.

**Acceptance criteria**
- [ ] `git tag` shows `legacy-v0` on the remote, pointing at the pre-reset `origin/main`.
- [ ] `main` contains no legacy app code; README makes no feature claims beyond "in progress".
- [ ] 0 open Dependabot PRs; 0 open legacy issues.

---

### 2. Scaffold monorepo (pnpm + uv) and CI
**Labels:** `area:repo` `type:chore` · **Depends on:** #1

**Scope**
- pnpm workspaces: `packages/core`, `apps/mobile`, `apps/web` (placeholders OK for apps).
- `ml/` as a uv project (Python 3.12), ruff + pytest configured.
- Shared `tsconfig.base.json` (strict), ESLint flat config, Prettier; Vitest in `core`.
- `data/` directory with README describing file formats and the freeze/hash rule.
- `evidence/` directory with README describing the evidence convention.
- CI (GitHub Actions): `core` typecheck/lint/test; `ml` ruff/pytest; runs on PRs and `main`. Remove the broken `release-drafter` workflow; keep CodeQL.
- Dependabot scoped to the new workspaces, grouped, weekly.

**Acceptance criteria**
- [ ] `pnpm install && pnpm -r test` passes locally and in CI.
- [ ] `uv run pytest` passes in `ml/` locally and in CI.
- [ ] CI runs on a PR and blocks merge on failure.

---

### 3. Spike: llama.rn inference on the Note 9S
**Labels:** `area:mobile` `type:spike` `needs-device` · **Depends on:** #2

**Context.** Decides which model sizes and quantizations are viable on the minimum-spec device, before we train anything. Legacy never ran a model on a device.

**Scope**
- Minimal Expo SDK 57 dev build (New Architecture) with `llama.rn`; Android build on Windows (local Android SDK or EAS).
- Load off-the-shelf GGUFs: Gemma 3 270M and Qwen3-0.6B at Q8_0, Q4_K_M, Q4_0 (+ one ~1B model if RAM allows).
- Measure per config: model load time, TTFT, prefill tok/s, decode tok/s, peak RSS, with threads = 2 / 4 / 6.
- Measure two prompt shapes: long (~400-token instructions + schema + note) vs short (note only, ~100 tokens) — quantifies the prefill cost fine-tuning would remove.
- Test JSON-schema-constrained generation works (grammar) and its overhead.
- Record Note 9S RAM variant and Android version.

**Acceptance criteria**
- [ ] `evidence/3/bench.json` with all measurements + device info; screen recording of one run.
- [ ] Short written decision (ADR `docs/adr/0001-on-device-runtime.md`): viable size range, best thread count, quant formats to carry forward, p50 latency target for the product.

---

### 4. Spike: offline speech-to-text on the Note 9S
**Labels:** `area:mobile` `type:spike` `needs-device` · **Depends on:** #3 (same dev build)

**Context.** On-device speech recognition on Xiaomi/Android 11 is unreliable; voice is the primary input.

**Scope**
- Record 10 spoken field notes (role-played; mix of quiet room and background noise).
- Compare: system recognizer in airplane mode (`expo-speech-recognition` with on-device preference) vs `whisper.rn` tiny.en and base.en (quantized).
- Measure: works offline (y/n), WER vs manual transcript, latency for a 30 s note, model size.

**Acceptance criteria**
- [ ] `evidence/4/stt.json` + recordings' manual transcripts committed (role-played, no PII).
- [ ] ADR `0002-speech-to-text.md` choosing primary + fallback STT.

---

### 5. Spike: same GGUF in the browser via wllama
**Labels:** `area:web` `type:spike` · **Depends on:** #2

**Scope**
- Minimal Vite page loading a GGUF from HF Hub via wllama; WebGPU offload vs WASM-only.
- Vercel preview deploy with COOP/COEP headers; confirm multithreading enabled.
- Measure load time, prefill/decode tok/s on the owner's laptop (Chrome) and on a phone browser.
- Verify JSON-schema grammar works in wllama.

**Acceptance criteria**
- [ ] Preview URL works in Chrome desktop; `evidence/5/bench.json` committed.
- [ ] ADR `0003-web-runtime.md` (wllama vs WebLLM/Transformers.js fallback decision).

---

## M1 — Eval foundation

### 6. core: schema v2, JSON Schema generation, compact codec
**Labels:** `area:core` `type:feature` · **Depends on:** #2

**Scope**
- Zod schema v2 exactly as design §5 (`jobType` enum, `laborMinutes`, `customerApproved` nullable, etc.).
- Export TS types; `toJsonSchema()` via `z.toJSONSchema`; committed generated `schema.json` with a CI check that it's up to date.
- Compact codec: short-key JSON ⇄ schema v2 (`encodeCompact`, `decodeCompact`), with round-trip property tests.
- Parse helper: raw model text → `{ ok, value | error, schemaValid }` (strip fences, tolerate trailing text).

**Acceptance criteria**
- [ ] Unit tests: valid/invalid fixtures, round-trip codec, malformed-output parsing.
- [ ] `schema.json` is consumed by `ml/` (Python validation test) — proving one source of truth.

---

### 7. core: the scorer (single source of all metrics)
**Labels:** `area:core` `type:eval` · **Depends on:** #6

**Scope**
- Inputs: gold JSONL + predictions JSONL (`{id, raw, parsed?, model, timings}`).
- Metrics per design §6: per-field accuracy / P/R/F1, **zero-edit rate**, JSON validity, hallucination rate (grounding check against source note), latency stats; slices by source (synthetic / role-played / real) and by hard-case tag.
- Fuzzy matchers for material names and list items (normalization, token overlap threshold).
- CLI: `pnpm score --gold data/test.jsonl --pred runs/<run>.jsonl --out results/<run>.json`.
- Validate matchers: 50 human pass/fail judgments in `data/matcher-validation.jsonl`; report agreement.

**Acceptance criteria**
- [ ] TDD unit tests for every metric (hand-computed expected values).
- [ ] Matcher agreement with human judgments ≥ 90% (or documented and threshold adjusted).
- [ ] Results JSON schema documented; consumed later by web (#29) and mobile (#25).

---

### 8. core: port the rule-based extractor as the baseline floor
**Labels:** `area:core` `type:eval` · **Depends on:** #6

**Scope**
- Port legacy `RuleBasedAiProvider` logic from `legacy-v0` **without improving it** (it is the honest floor), adapting output to schema v2.
- Also used in-app as the zero-download fallback.
- Document known failure modes from the audit (hours not parsed, negations missed, verb stripping, substring unit matches).

**Acceptance criteria**
- [ ] Characterization tests pinning current behavior on 10 notes.
- [ ] Runs through the scorer CLI → `results/rules.json`.

---

### 9. data: scenario matrix and synthetic test/dev notes
**Labels:** `area:data` `area:ml` `type:eval` · **Depends on:** #6

**Scope**
- `data/scenarios.yaml`: trades × styles (terse / rambling / spoken with fillers / run-on) × hard-case tags (hours phrasing, negation, self-correction, multiple materials, no materials, supply-house trip, extra labor mention, approval absent).
- Generator script (`ml/gen_eval_notes.py`) using the Gemini API free tier (throttled, checkpointed) to draft ~250 notes + draft labels from the matrix (150 test, 100 dev), with coverage report per tag.
- Store drafts as `data/drafts/*.jsonl` (not yet gold).

**Acceptance criteria**
- [ ] Every hard-case tag has ≥ 8 test examples.
- [ ] Generation is reproducible (seed, model id, prompt committed); token usage logged; $0 spend on free tier (or approved minimal spend).

---

### 10. Labeling tool + human verification; freeze test set
**Labels:** `area:web` `area:data` `type:eval` · **Depends on:** #9

**Scope**
- Dev-only `/label` route in `apps/web`: shows note + draft label, edit fields, accept/flag; keyboard-driven; writes JSONL.
- Owner verifies all ~250 drafts.
- Freeze: `data/test.jsonl`, `data/dev.jsonl` + SHA-256 in `data/FROZEN.md`; CI check that frozen files are unchanged.
- `docs/DATA_CARD.md` (sources, labeling protocol, known biases incl. synthetic-data caveat).

**Acceptance criteria**
- [ ] 100% of test/dev examples human-verified (tracked field in JSONL).
- [ ] Label edit rate from draft → gold reported (how often the teacher was wrong).
- [ ] Freeze check in CI.

---

### 11. ml: batch inference runners (llama.cpp + cloud baseline)
**Labels:** `area:ml` `type:eval` · **Depends on:** #6, #7

**Scope**
- `ml/run_llamacpp.py`: runs any GGUF over a JSONL split via llama-cpp-python (or `llama-server`); options: prompt variant (zero-shot / few-shot / fine-tuned-short), grammar on/off, temperature 0, chat template; writes predictions JSONL with timings.
- `ml/run_cloud.py`: cloud ceiling via Gemini (free tier) with structured output; logs tokens and computes $/note at published paid-tier prices (for the cost comparison), even though runs are free.
- Optional extra rung: Apple Foundation Models on iPhone 16 Pro, run via the mobile benchmark screen (#25).
- Deterministic run IDs; config saved alongside predictions.

**Acceptance criteria**
- [ ] One command reproduces any run: `uv run python run_llamacpp.py --config configs/<run>.yaml`.
- [ ] Output scored via core CLI without manual steps (`make eval RUN=...`).

---

### 12. Baseline ladder results + error analysis (RESULTS v0)
**Labels:** `area:ml` `type:eval` · **Depends on:** #8, #10, #11

**Scope**
- Run: rules; Gemma 3 270M, Qwen3-0.6B, ~1B, ~2B general models (zero-shot and few-shot, grammar on/off); cloud ceiling.
- Error analysis on dev set: read ≥ 50 failures, build a failure taxonomy (Hamel-style open coding → categories with counts).
- `docs/RESULTS.md` v0 + `results/*.json`.

**Acceptance criteria**
- [ ] Table: per-field metrics, zero-edit rate, validity, hallucination, $/note for every rung.
- [ ] Failure taxonomy with ≥ 5 categories and example IDs.
- [ ] Explicit go/no-go note on the fine-tuning hypothesis given baseline gaps.

---

## M2 — Model

### 13. Synthetic training set with agreement filtering and leakage check
**Labels:** `area:ml` `area:data` · **Depends on:** #9, #12

**Scope**
- Generate 3–5k notes from the scenario matrix (weighted toward failure-taxonomy categories) using the Gemini free tier (throttled over multiple days if needed, resumable), labeled twice independently by the teacher; keep only schema-valid + agreeing examples.
- Leakage check: n-gram (e.g., 8-gram) overlap and near-duplicate detection vs test/dev; drop matches.
- Publish to HF Datasets with a dataset card (license, generation method, filters, stats).

**Acceptance criteria**
- [ ] Agreement-filter drop rate and leakage-drop counts reported.
- [ ] Zero test/dev near-duplicates (script output committed).
- [ ] HF dataset public, linked from `DATA_CARD.md`.

---

### 14. Fine-tune Gemma 3 270M and Qwen3-0.6B
**Labels:** `area:ml` · **Depends on:** #13

**Scope**
- Training script (TRL SFT or Unsloth): input = note only (no instructions), target = compact JSON; full FT for 270M, LoRA or full for 0.6B; runnable on a free Kaggle or Colab GPU (notebook + script); no paid compute.
- Hyperparameters and seeds in config; training logs committed (loss curves).
- Evaluate each checkpoint on dev via #11 → pick winner(s).

**Acceptance criteria**
- [ ] Reproducible training (config + command + GPU type + wall time documented).
- [ ] Dev-set comparison vs zero/few-shot baselines of same size and the ~2B baseline.

---

### 15. Quantization ladder, GGUF export, HF release, model manifest
**Labels:** `area:ml` · **Depends on:** #14

**Scope**
- Convert to GGUF (`convert_hf_to_gguf.py`) and quantize: F16, Q8_0, Q6_K, Q4_K_M, Q4_0.
- Evaluate each on **test** set, grammar on/off.
- Publish to HF Hub with `MODEL_CARD.md` (intended use, eval results by slice, limitations, failure taxonomy).
- `models/manifest.json`: id, display name, URL, sha256, size, quant, min RAM, test-set scores — consumed by mobile (#18) and web (#28).

**Acceptance criteria**
- [ ] Accuracy vs size vs quant table in `RESULTS.md`.
- [ ] sha256s in manifest match published files (CI check that fetches HEAD/size).

---

### 16. On-device benchmark of finalists; choose defaults
**Labels:** `area:ml` `area:mobile` `type:eval` `needs-device` · **Depends on:** #15, #25

**Scope**
- Run finalists (fine-tuned 270M/0.6B at 2–3 quants + best general baseline) through the in-app benchmark (#25) on the Note 9S and iPhone 16 Pro; on iPhone also run Apple Foundation Models as a comparison rung.
- Choose catalog defaults: "Fast" and "Accurate".

**Acceptance criteria**
- [ ] `evidence/16/*.json` + recording; per-device table in `RESULTS.md`.
- [ ] ADR `0004-default-models.md` with the accuracy/latency/size trade-off stated in numbers.

---

## M3 — Mobile MVP (Android-first)

### 17. App shell, SQLite schema, tested repositories
**Labels:** `area:mobile` `type:feature` · **Depends on:** #2, #3

**Scope**
- Expo SDK 57 + Expo Router; tables per design §7; migrations wrapped in transactions, `PRAGMA user_version`, foreign keys on every connection, indexes on FKs.
- Repository layer behind a small DB adapter so tests run against real SQLite (better-sqlite3) in Node — no regex mocks.
- Every write that touches multiple tables is transactional.

**Acceptance criteria**
- [ ] Repository tests against real SQLite: CRUD, soft delete, migration from empty and from previous version.
- [ ] App boots on Note 9S dev build.

---

### 18. Model catalog, download manager, inference lifecycle
**Labels:** `area:mobile` `type:feature` `needs-device` · **Depends on:** #15 (manifest; can start with a stub manifest), #17

**Scope**
- Catalog screen from `manifest.json`: size, eval accuracy, **measured speed on this phone** (after benchmark), download/delete.
- Download: Wi-Fi prompt, free-space check, resumable, progress, sha256 verification, cancel.
- Inference service: load once and keep warm, unload on background/memory warning, single-flight queue, timeout that calls `stopCompletion`, chat template, JSON-schema grammar, compact decoding via core.
- Rule-based extractor used when no model is installed.

**Acceptance criteria**
- [ ] Airplane-mode extraction works after download (recording on Note 9S).
- [ ] Killing network mid-download → resumes; corrupt file → rejected by checksum (tested).
- [ ] Two rapid extractions don't run concurrently; timeout cancels generation (log evidence).

---

### 19. Capture screen: voice, typed fallback, photos
**Labels:** `area:mobile` `type:feature` `needs-device` · **Depends on:** #4, #17

**Scope**
- Big tap-to-talk with live transcript (STT per ADR 0002); typed input always available; audio saved for replay.
- Before/after photos copied into app document storage (not picker cache URIs).
- Large touch targets, one-handed layout.

**Acceptance criteria**
- [ ] 30 s voice note captured offline on Note 9S, transcript shown, audio replayable after app restart.
- [ ] Photos survive app restart and cache clearing.

---

### 20. Review screen: editable extraction with grounding highlights
**Labels:** `area:mobile` `type:feature` · **Depends on:** #18, #19

**Scope**
- Run extraction on capture; show fields as editable cards; highlight source spans in the note for each extracted value; flag ungrounded values.
- Track per-field edits (`line_items.source`, `edited`) → local zero-edit stats.
- Raw model output, model id, timings stored in `extractions`.

**Acceptance criteria**
- [ ] Component tests for edit tracking; E2E path covered in #26.
- [ ] Ungrounded value visibly flagged (screenshot evidence).

---

### 21. Price list and deterministic pricing
**Labels:** `area:mobile` `area:core` `type:feature` · **Depends on:** #17

**Scope**
- Price list screen: add/edit items, paste or import CSV, labor rate (hourly, min charge).
- `core` pricing: normalize + fuzzy match extracted material → price item (synonyms, units); unmatched items flagged "no price"; totals computed in code, never by the model.

**Acceptance criteria**
- [ ] TDD tests for matching (synonyms, plurals, units, ambiguous matches) and totals (rounding, min charge).
- [ ] CSV import handles a sample exported from a spreadsheet.

---

### 22. Missed-billables check ("dollars caught")
**Labels:** `area:core` `area:mobile` `type:feature` · **Depends on:** #21

**Scope**
- Deterministic rules in `core`: (a) mentioned-but-unpriced materials; (b) history co-occurrence suggestions from the user's past jobs of the same type (threshold + explanation text); (c) labor/supply-trip mentions not reflected in line items.
- One-tap add in Review; every suggestion shows *why*.
- Metric: dollars caught on test scenarios with a reference price list (added to scorer).

**Acceptance criteria**
- [ ] Unit tests per rule, including no-false-positive cases.
- [ ] "Dollars caught" reported in `RESULTS.md`.

---

### 23. Job record, jobs list/search, PDF/text/CSV export
**Labels:** `area:mobile` `type:feature` · **Depends on:** #20, #21

**Scope**
- Jobs list with search (customer/address/material text) — this is the "job memory" value.
- Job record view; export: PDF (`expo-print`, customer-safe — no internal notes), plain text share, CSV (QuickBooks-importable columns).

**Acceptance criteria**
- [ ] PDF contains line items, totals, photos; no internal fields (test on rendered HTML).
- [ ] CSV imports into QuickBooks sample template (or documented column mapping verified against its import spec).

---

### 24. Backup/restore and opt-in "share for improvement"
**Labels:** `area:mobile` `type:feature` · **Depends on:** #17

**Scope**
- Export backup (DB + photos + audio) as a single file via share sheet; restore from file with version check.
- Opt-in per-job share bundle: note/transcript + corrected record (+ optional audio) as JSON for eval contribution; clear consent text; nothing automatic.
- In-app explanation of backup limits (no cloud).

**Acceptance criteria**
- [ ] Round-trip test: backup → uninstall → reinstall → restore → identical data (recorded on Note 9S).
- [ ] Share bundle validates against a documented schema consumed by `ml/` ingestion.

---

### 25. On-device benchmark screen
**Labels:** `area:mobile` `type:eval` · **Depends on:** #18

**Scope**
- Runs a fixed benchmark subset (bundled, ~30 test notes) with selected model: load time, TTFT, prefill/decode tok/s, end-to-end latency, peak memory; also scores accuracy with `core` scorer on-device.
- Exports results JSON (device model, OS, RAM, app/model versions) via share sheet in the format `RESULTS.md`/web consume.

**Acceptance criteria**
- [ ] Output JSON validates against results schema from #7.
- [ ] Same model + notes give consistent accuracy with the llama.cpp desktop run (within tolerance; differences explained).

---

### 26. End-to-end test and device verification checklist
**Labels:** `area:mobile` `type:chore` `needs-device` · **Depends on:** #20, #23

**Scope**
- Maestro flow on Android emulator in CI (or nightly): create job → typed note → extract (rules model) → accept → price → export.
- `docs/DEVICE_CHECKLIST.md`: manual checks on Note 9S (airplane mode, low storage, backgrounding mid-inference, kill/restart).

**Acceptance criteria**
- [ ] Maestro flow green.
- [ ] Checklist executed on Note 9S with evidence committed.

---

### 27. Distribution: APK, Play closed testing, iOS build
**Labels:** `area:mobile` `type:chore` · **Depends on:** #18 (start Play setup early — the 14-day clock)

**Scope**
- Signed release APK for direct testers (GitHub Release).
- Play Console: app listing, privacy policy ("no data collected"), data safety form, **closed testing track with ≥ 12 testers opted in for 14 continuous days** (recruited via #30); then production application.
- iOS: dev build on owner's iPhone 16 Pro (free Apple ID signing works for local installs); TestFlight only if an Apple developer account exists — optional.
- Model files are downloaded post-install, keeping the app small.

**Acceptance criteria**
- [ ] Closed test live by ~day 10 with tester count tracked.
- [ ] APK installs and works on a second Android device (if available).

---

## M4 — Web demo & evidence

### 28. Web "Try it" page (in-browser extraction)
**Labels:** `area:web` `type:feature` · **Depends on:** #5, #15

**Scope**
- Vite + React app; paste/type a note (optional mic via Web Speech/whisper later) → extraction via wllama with manifest models; model picker; capability check (WebGPU/threads/memory) and download-size confirmation before load; cached after first load.
- Live network indicator ("0 bytes sent after model load"), timings, grounding highlights (reuse core).
- Sample notes including hard cases.

**Acceptance criteria**
- [ ] Works on Chrome desktop and one phone browser; graceful message on unsupported browsers.
- [ ] Lighthouse accessibility ≥ 90.

---

### 29. Results & evidence pages; deploy
**Labels:** `area:web` `area:docs` · **Depends on:** #12, #15, #16

**Scope**
- Results page rendered from committed `results/*.json`: headline chart (accuracy vs model size, cloud as reference line), zero-edit rate, quant ladder, per-device perf (Note 9S/iPhone/laptop), runtime comparison (llama.cpp vs wllama vs llama.rn), failure taxonomy, dollars caught.
- Links: HF model/dataset, APK/Play test, write-up, repo.
- Vercel production deploy with COOP/COEP; custom domain optional.

**Acceptance criteria**
- [ ] Every number on the page traces to a committed results file (no hard-coded numbers).
- [ ] Live URL in README.

---

## M5 — Launch & outreach

### 30. Outreach kit and tester recruitment (owner-led)
**Labels:** `outreach` · **Depends on:** — (start on day 1)

**Scope**
- Drafts: Reddit/Facebook post (feedback ask, per-sub rules), Mom-Test interview script (last week's paperwork, not a pitch), consent note for voice recordings, tracker sheet.
- Targets: r/handyman, r/HVAC, r/Plumbing, r/electricians, r/sweatystartup, local trade FB groups, Nextdoor, trade-school instructors.
- Goals: 5 interviews, 12 Play testers, ≥ 15 consented real voice notes.
- Interview synthesis note: does it beat Notes-app dictation? Are flagged items real dollars?

**Acceptance criteria**
- [ ] Interview notes synthesized in `docs/research/interviews.md` (anonymized).
- [ ] Tester and recording counts reported honestly (including if targets missed).

---

### 31. Real-voice eval slice
**Labels:** `area:data` `type:eval` · **Depends on:** #4, #10, #30

**Scope**
- Collect ~50 spoken notes: consented tradesperson recordings (#30) + role-played by owner/friends; transcribe with the app's STT; label via `/label`; tag source.
- Add to test set as a **separate, versioned slice** (v1.1) — the original frozen set stays unchanged.
- Report results by slice; if real notes differ materially from synthetic, say so prominently.

**Acceptance criteria**
- [ ] Slice metrics in `RESULTS.md` with sample sizes.
- [ ] Consent recorded for every non-owner recording; no customer PII in committed data.

---

### 32. Write-up, README, demo video, launch
**Labels:** `area:docs` · **Depends on:** #29, #31

**Scope**
- Write-up (blog + `docs/WRITEUP.md`): "Can a 270M model replace an API call?" — problem, market gap, data, ladder, fine-tune, quantization on a budget phone, failure taxonomy, what didn't work.
- README: headline number, live link, APK/Play link, 90-second airplane-mode video, reproduce-in-one-command, architecture diagram.
- Resume bullet with real numbers.
- Post to outreach channels (#30) and relevant ML communities.

**Acceptance criteria**
- [ ] Every claim in README/write-up links to an artifact (results file, evidence folder, HF card).
- [ ] Fresh-clone reproduction of one eval run verified by following README only.

---

## Dependency overview

```
#1 → #2 → {#3 → #4, #5, #6}
#6 → {#7, #8, #9} ; #9 → #10 ; {#6,#7} → #11 ; {#8,#10,#11} → #12
#12 → #13 → #14 → #15 → #16 (also needs #25)
#3 → #17 → {#18, #19, #21, #24} ; #18 → {#20, #25, #27} ; #21 → #22 ; {#20,#21} → #23 ; {#20,#23} → #26
{#5,#15} → #28 ; {#12,#15,#16} → #29
#30 (day 1, parallel) → #31 → #32
```
