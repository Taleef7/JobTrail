# JobTrail v2 — Rebuild Design

**Date:** 2026-09-28
**Status:** Draft for owner review
**Supersedes:** `docs/PLAN.md`, `docs/AGENT_HANDOFF.md`, `docs/superpowers/specs/2026-06-17-local-llm-design.md` (legacy, tagged `legacy-v0`)

---

## 1. Why a rebuild

An audit of the legacy codebase (2026-09-28) found:

- **Agent-generated breadth, no verification.** 27 of 43 commits landed on 2026-05-17. Typecheck/lint/112 tests pass, but the product is broken.
- **Core flow broken.** A new job cannot get its first note/photo/material/time entry (add buttons live inside sections rendered only when non-empty).
- **Sync engine (grade F).** Notes/materials/time never reach Firestore (looked up by wrong id, marked synced); deletes never propagate; fresh installs never restore; cross-account leakage on shared devices.
- **On-device LLM never ran on a device.** Apple provider schema throws on every iOS 26 device; model reloaded per call; timeouts don't cancel; UI claims 0.8 GB for a 2.2–3.4 GB model; spec ticked "✅ processed a note on a test device" before code existed.
- **Misplaced priorities.** The original plan put on-device ML — the project's actual purpose — at Phase 10 of 10, "optional".

**Kept (as ideas, not code):** extraction schema + prompt rules; provider-cascade interface; review-before-apply UX; `ai_extraction_results` as an eval/feedback log; rule-based extractor as an eval floor.
**Dropped:** Firebase, auth, cloud sync, clients/sites, signatures, the entire legacy app.

## 2. Goals

1. **ML showcase (primary):** Distill structured extraction from a cloud model into a fine-tuned, quantized sub-1B model that runs fully on-device — on a 2020 budget Android — and prove its quality with a public, reproducible eval.
2. **Real-world value:** Give solo tradespeople a free, offline, no-account tool that turns a 30-second end-of-job voice note into a priced job record, catches forgotten billables, and exports to whatever they already invoice with.
3. **Every claim verifiable:** live demo, public test set, model/dataset cards, one-command reproduction, device evidence committed to the repo.

### Non-goals
Invoicing/payments, cloud sync, accounts, multi-user crews, direct QuickBooks/Jobber API integrations, on-site quoting, research novelty claims.

## 3. Market positioning (from research, 2026-09-28)

- Pain is real but mild and poorly measured. The most recurrent complaint is **forgetting to bill for materials**; vendor "revenue leakage" statistics are untraceable.
- **Voice-to-invoice is crowded:** Jobber Voice and Housecall Pro voice invoicing (Sep 2025, cloud), QuickBooks Intuit Assist, CompanyCam AI Walkthrough, and VoicePrice (iOS, Apple on-device model, no account, Mar 2026). "Free" isn't differentiating (Square, Pronto).
- **Real competitor:** Notes-app dictation.
- **Open gaps:** true offline capture/editing (HCP no offline edit; Jobber partial; ServiceTitan data-loss reports), **on-device AI on budget Android** (Apple FM needs iPhone 15 Pro+; Gemini Nano needs Pixel 8/S24-class), missed-billable detection against the user's own prices, export into existing tools.

**Positioning:** *JobTrail is the offline capture layer. Talk for 30 seconds at the truck; get a structured, priced job record that flags what you'd forget to bill; export it to whatever you invoice with. Runs on the phone you already have — no signal, no account.*

## 4. Architecture

```
JobTrail/
  packages/core/   TS: Zod schema v2 (single source of truth) → JSON Schema; compact output codec;
                   scorer (the ONLY scorer); rule-based baseline; price matching; missed-billables rules
  data/            JSONL: test set (human-verified, frozen + hashed), dev set; scenario matrix
  ml/              Python (uv): data generation, fine-tuning, GGUF export/quantization, batch inference
  apps/mobile/     Expo SDK 57 (New Arch), expo-sqlite, llama.rn, STT — THE PRODUCT (Android-first)
  apps/web/        Vite + React: live in-browser demo (wllama) + results/evidence pages → Vercel
  docs/            RESULTS.md, MODEL_CARD.md, DATA_CARD.md, ADRs
```

Tooling: pnpm workspaces, uv for Python. CI: typecheck, lint, tests for core/mobile/web; ruff + pytest for ml.

**Rules:**
1. **One schema.** Zod in `core` generates TS types and JSON Schema (`z.toJSONSchema`). JSON Schema drives constrained decoding (llama.cpp grammar) in wllama and llama.rn, and validation in Python.
2. **One scorer.** Python produces predictions JSONL only. All metrics come from `core`'s scorer (CLI in CI, in-app benchmark, web results) so numbers can't disagree.
3. **One model artifact.** The same GGUF runs in llama.cpp (eval), wllama (web) and llama.rn (mobile).

## 5. Extraction task — schema v2

```ts
{
  jobType: enum(plumbing | electrical | hvac | carpentry | appliance | cleaning | painting | roofing | general) | null,
  workPerformed: string[],        // short action statements
  issuesFound: string[],
  materials: { name: string, quantity: number | null, unit: string | null }[],
  laborMinutes: number | null,
  customerApproved: boolean | null,   // null = not mentioned
  followUps: string[],
}
```

Removed from legacy: `confidence` (self-reported confidence is noise), `missingFields` (derived from nulls), `estimatedCost` (hallucination bait — prices come from the user's price list).
**Grounding check (post-hoc):** every extracted number and material must be supported by the source note → hallucination rate, without adding output tokens.
**Compact output codec:** fine-tuned models emit a short-key JSON form, decoded to schema v2 in `core` — fewer decode tokens on slow CPUs.

## 6. ML pipeline

### Data
- **Scenario matrix:** trades × note style (terse, rambling, spoken with fillers) × hard cases (hours as "hour and a half", negations "didn't sign", self-corrections "two, no three", multiple materials, no materials, supply-house trips, mentions of extra labor).
- **Test set (~200, frozen, never trained or tuned on):** ~150 synthetic (teacher-drafted, **human-verified** labels) + ~50 spoken notes role-played by the owner (see §10), transcribed by the app's STT on the Note 9S, labeled. Spoken vs synthetic reported **separately**.
- **Dev set (~100):** for prompt/model iteration and error analysis.
- **Train set (3–5k synthetic):** teacher-generated notes + labels; kept only if schema-valid and two independent teacher labelings agree; n-gram leakage check against test/dev; published to HF Datasets.

### Model ladder
1. **Floor:** legacy rule-based extractor (unchanged).
2. **Zero/few-shot small general models:** ~270M–2B (e.g., Gemma 3 270M, Qwen3-0.6B, Llama 3.2 1B, one ~2B). Final list confirmed against llama.cpp support.
3. **Fine-tuned:** Gemma 3 270M and Qwen3-0.6B (full FT or LoRA on free Colab/Kaggle GPU), trained with **no instruction prompt** (input = note only) and compact output. **Added 2026-09-30 (#110):** LFM2-350M-Extract (Liquid AI; pretrained for schema-guided extraction; hybrid conv/attention built for CPUs; 27% faster decode than Gemma 270M on a desktop CPU) and SmolLM2-135M (145 MB; about 2× Gemma's decode speed). All four were tried zero-shot on the scorer's demo notes and none was usable without fine-tuning; the fine-tune ladder picks the winner on accuracy, speed and size.
4. **Ceiling:** cloud model with structured output (quality, $/note, latency).

### Quantization study
Fine-tuned winner(s) exported at F16, Q8_0, Q6_K, Q4_K_M, Q4_0; constrained decoding on vs off. Measure accuracy vs size vs speed — on the Redmi Note 9S specifically (Cortex-A76 dotprod may favor Q4_0/Q8_0 kernels; test, don't assume).

### Metrics (all from `core` scorer; binary per-field judgments)
- Per field: accuracy (jobType, laborMinutes, customerApproved); P/R/F1 (materials: fuzzy name + exact quantity; list fields: fuzzy match — matcher validated against ~50 human judgments).
- **Zero-edit rate** (headline product metric).
- JSON validity rate; hallucination rate.
- **Dollars caught** (missed-billables flags accepted, on test scenarios with a reference price list).
- Performance: load time, TTFT, prefill tok/s, decode tok/s, end-to-end latency, peak RAM, download size — per device.
- Published failure taxonomy from dev-set error analysis.

**Hypothesis (to test, not assume):** a fine-tuned ≤0.6B model matches a ~2B general model zero-shot at ~¼ the download and is fast enough (target: p50 ≤ 8 s end-to-end on Note 9S — revised after the device spike) while approaching the cloud ceiling at $0/note. If false, publish honestly.

## 7. Mobile app (the product)

**Minimum-spec device:** Redmi Note 9S, 6 GB (Snapdragon 720G, CPU-only inference, 2× A76 + 6× A55). iPhone 16 Pro second — also allows Apple Foundation Models as a comparison rung.

**Runtime:** llama.rn; one model loaded once and kept warm; unload on background/memory pressure; single-flight inference queue; real cancellation (`stopCompletion`) on timeout; chat template applied; JSON-schema grammar.

**Model catalog (user choice):** manifest (id, display name, HF URL, sha256, size, quant, min RAM, eval scores). Users pick e.g. "Fast (270M)" vs "Accurate (0.6B)"; the app shows size, **measured speed on this phone**, and eval accuracy. Download after onboarding over Wi-Fi, resumable, checksum-verified, storage check, deletable. Fully offline afterward. Rule-based extractor works with no model downloaded.

**Speech-to-text:** system on-device recognizer where available; whisper.rn (tiny.en/base.en) fallback — decided by device spike. Typed input always available. Audio kept for replay.

**Screens:** Jobs (list/search, big mic) · Capture (voice, live transcript, photos copied into app storage) · Review (editable fields, grounding highlights, price-matched materials, labor × rate, missed-billable flags, total) · Job record (PDF/text share, CSV) · Price list (paste/CSV import, labor rate) · Settings (model catalog, backup/restore, benchmark screen).

**Data:** `jobs`, `captures`, `extractions` (raw output, model id, timings, validity), `line_items` (source: model/user/suggestion; edited flag), `price_items`, `photos`. Migrations in transactions.

**Missed-billables (deterministic, auditable):** (a) materials mentioned but unmatched/unpriced; (b) history co-occurrence ("your last 4 water-heater jobs included flex lines"); (c) labor/trips mentioned but not billed.

**Privacy:** nothing leaves the device unless the user shares it. Opt-in "share for improvement" bundle (note + corrected record) via share sheet — the only path for real-world eval data.

**Backup:** explicit export/restore of a backup file + OS backup; limits documented in-app.

**Distribution:** Signed release APK on GitHub Releases each mobile milestone, installed on the Note 9S from that release for verification. Public Play release is out of scope (needs a 12-tester closed test); Play internal testing optional. iOS dev build on the iPhone 16 Pro; TestFlight only if an Apple developer account exists.

## 8. Web app (demo + evidence, not the product)

Rationale: iOS Safari may evict PWA storage after weeks of non-use and web apps can't use system models — so the web is a zero-install demo and the evidence surface, not the tradesperson product.

- **Try:** type/paste (optional: record) a note → extraction runs in-browser via wllama with the same GGUF; model picker; capability check + download-size warning before loading; live "0 bytes sent" network indicator; timings.
- **Results:** headline chart (accuracy vs model size, cloud as reference line), zero-edit rate, quantization ladder, per-device performance (Note 9S, iPhone, laptop browser), runtime comparison (llama.cpp vs wllama vs llama.rn), failure taxonomy. Rendered from committed results JSON.
- **Links:** HF model + dataset cards, APK / Play testing link, write-up, repo.
- **Dev-only `/label` route:** labeling tool reusing the review component, for building the test set.
- **Deploy:** Vercel static, COOP/COEP headers for wllama threads; weights served from HF Hub.

## 9. Showcase surface

| Reviewer | Time | Sees |
|---|---|---|
| Recruiter | 30 s | Headline number + live link |
| Hiring manager | 5 min | Try in browser; results chart |
| Engineer | 30 min | Repo, model/data cards, write-up, failure taxonomy |
| Interview | 45 min | Trade-offs: quantization, constrained decoding, prefill on CPU, leakage prevention |

Deliverables: live URL, 90-second airplane-mode phone video, APK/Play link, HF model + dataset, write-up ("Can a 270M model replace an API call?"), resume bullet with real numbers.

## 10. Testing without outreach (revised 2026-09-29)

Outreach to tradespeople was dropped — the owner can't reliably reach them. The owner tests in depth instead (issue #91, `docs/TEST_PROTOCOL.md`): 6 trade personas × 5 scripted scenarios, a condition matrix (noise, airplane mode, low storage, backgrounding), on the Note 9S, iPhone 16 Pro and a laptop browser. The spoken-note eval slice is role-played and labeled as such. Portfolio framing: *"built for solo tradespeople, grounded in their documented pain points; tested by the developer through scripted role-play on a 2020 budget phone."* Never "used by".

## 11. Verification rules (lessons from legacy)

Every issue follows [`docs/WORKFLOW.md`](../../WORKFLOW.md): pre-flight review → before snapshot → test-first implementation → local verification → ship to the live surface → after snapshot and evidence-backed close. A walking-skeleton web app is live from M0 (#63) so every change is observable.


- No ✅ without evidence. Device claims require a committed benchmark JSON + screen recording from the named device.
- Evals before app polish. Numbers in README/web must come from committed results files.
- Each milestone ends with something live or on-device.

## 12. Schedule (2–3 weeks)

| Days | Milestone |
|---|---|
| 1–2 | **M0 Reset & de-risk:** archive legacy, scaffold monorepo + live walking skeleton, device/STT/web runtime spikes. |
| 3–7 | **M1 Eval foundation:** schema, scorer, rules baseline, test/dev sets labeled, baseline ladder + RESULTS v0. |
| 6–12 | **M2 Model:** training data, fine-tune, quantization ladder, HF publish, on-device finalists. |
| 6–16 | **M3 Mobile MVP:** capture → review → price → flags → export; model catalog; backup; benchmark screen. Release APK per milestone. |
| 13–18 | **M4 Web demo & evidence.** |
| 16–21 | **M5 Launch:** role-played spoken-note slice, write-up, video, README; full scripted test session. |

## 13. Resources & budget

**Preference: free resources first; minimal spend only if a free tier blocks progress.**

| Need | Free option (primary) | Paid fallback |
|---|---|---|
| Teacher model (eval drafts, training data) | Gemini API free tier (Flash / Flash-Lite), rate-limited batch generation with checkpointing | Gemini paid tier — a few dollars at most |
| Cloud ceiling baseline | Gemini free tier (structured output) | — |
| Fine-tuning GPU | Kaggle (free weekly GPU quota) or Colab free T4 — ≤1B models fit | Colab Pay-as-you-go |
| Model + dataset hosting | Hugging Face Hub | — |
| Web hosting | Vercel Hobby | — |
| CI | GitHub Actions (public repo) | — |
| Android distribution | APK via GitHub Releases (free); Play Console $25 one-time for closed testing | — |
| iOS | Local dev builds with a free Apple ID (7-day signing) | Apple Developer $99/yr for TestFlight — optional |

Scripts that call cloud models must respect free-tier rate limits (throttle + resume from checkpoint) and log token usage.

## 14. Devices & open questions

- **Android:** Redmi Note 9S, 6 GB RAM (Android version to confirm).
- **iOS:** iPhone 16 Pro (A18 Pro → Apple Foundation Models available as an extra comparison rung).
- Apple developer account status unknown — TestFlight is optional; not on the critical path.
