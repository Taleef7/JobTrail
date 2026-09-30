# Changelog

All notable changes to JobTrail v2. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Each merged issue adds an entry. The legacy app (v0.1.0) is preserved at the `legacy-v0` tag.

## [Unreleased]

### Fixed
- Scorer: a correct quantity of 1 said as "a"/"an" ("used a wax ring") counted as hallucinated. The article now grounds 1 only for the material it introduces (within 3 content words, same clause), so invented 1s stay ungrounded; trade-off in `packages/core/SCORING.md` (#106).
- `/spike/` returned 404 in production (Vercel doesn't map the directory URL to `spike/index.html`); explicit rewrites added — found by live verification (#66).

### Changed
- Workflow: PRs reference issues with `Refs #N`; issues are closed manually after live verification (#63, lesson from #62).

### Removed
- Legacy app (Expo 54 + Firebase sync + cascade AI), its docs, EAS and release-drafter workflows — archived at tag `legacy-v0` (#62). An audit found the core flow and sync engine broken and on-device claims unverified; see the design doc.

### Added
- Rule-based baseline (`extractWithRules`): the legacy v0 regex extractor ported without improvement, as the floor every model must beat and the no-download fallback. A differential test requires it to reproduce the unmodified legacy file's outputs; 10 characterization notes pin its known failure modes (hours, negations, substring units). `pnpm baseline` writes predictions for `pnpm score`; demo-fixture report in `results/rules.json` (#69).
- Scorer (`@jobtrail/core`): per-field accuracy and P/R/F1, zero-edit rate, parse/schema-valid rates, hallucination (grounding) rate, latency, slices by source and tag; failures always count. `pnpm score` CLI runs on Node 24's native TypeScript. Definitions in `packages/core/SCORING.md` (#68).
- Score report contract (`ScoreReportSchema` → `schema/score-report.v1.json`) for the web and phone apps (#68).
- `@jobtrail/core` schema v2: strict Zod contract, generated JSON Schemas (full + compact) guarded by a drift test, compact codec with property-based round-trip tests, and `parseModelOutput` (#67).
- Shared schema fixtures judged identically by Zod (TS) and `jsonschema` (Python) (#67).
- `ml/scripts/check_constrained.py`: proves the generated schemas work as llama.cpp grammars and measures compact-vs-full token counts (#67).
- `/spike/`: in-browser llama.cpp benchmark (wllama) measuring prefill/decode speed, time-to-first-token and JSON validity across models, backends and prompt shapes; results downloadable as JSON (#66).
- ADR 0003: wllama as the web runtime, always schema-constrained, WebGPU → WASM fallback (#66).
- Monorepo skeleton: pnpm workspaces (`packages/core`, `apps/web`), `ml/` uv project, strict TypeScript, ESLint, Prettier, Vitest, pytest + ruff (#63).
- Live build-info site on Vercel: deployed commit, environment, live milestone progress, and this changelog as "What's shipped" (#63).
- CI for TypeScript, Python and docs; Dependabot for npm, uv and GitHub Actions; `main` branch protection (#63).
- Repo-hygiene tests that fail if `.env` files or model weights ever become committable (#63).
- v2 design doc, per-issue workflow (`docs/WORKFLOW.md`), and issue drafts (#62).
- Minimal docs-only CI; PR template enforcing pre-flight / before / after evidence (#62).
