# Changelog

All notable changes to JobTrail are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/).

> **Note:** Release notes are auto-drafted by
> [release-drafter](https://github.com/release-drafter/release-drafter) on
> every push to `main`. This file is the human-curated source of truth for
> milestones, not per-commit notes.

---

## [Unreleased]

### Added

- GitHub repo hygiene: PR template, issue templates, `CODEOWNERS`,
  Dependabot config, release-drafter workflow
- `LICENSE` (MIT) and `CHANGELOG.md`
- EAS build configuration for preview + production mobile builds

### Planned

- `expo-av` → `expo-audio` migration (SDK 54 deprecation)
- Cloud LLM extraction polish (Gemini prompt + Zod validation)
- Local LLM proof-of-concept (Milestone D)
- Speech-to-text for voice notes
- Sync conflict UI
- Architecture documentation: `ARCHITECTURE.md`, `DATA_MODEL.md`,
  `SYNC_STRATEGY.md`, `AI_STRATEGY.md`, `TESTING_STRATEGY.md`,
  `DECISIONS/` ADRs

---

## [0.1.0] — 2026-05-17

### Milestone A — Local job capture

- Expo SDK 54 + TypeScript (strict) + Expo Router (file-based)
- SQLite local persistence with migrations
- Domain types + Zod schemas
- Repositories: jobs, notes, materials, time entries, AI extraction results
- Screens: job list, create job, job detail, add note, add material, add time
- `AiProvider` interface + `MockAiProvider` + `RuleBasedAiProvider`
- AI suggestions review flow with accept/reject
- Local report preview

### Milestone B — Photos, auth, sync

- Firebase Auth: email/password + Google sign-in
- `AuthContext` + `SyncContext`
- Photo capture (local + Firebase Storage upload on sync)
- `firestoreSync.ts` two-way sync with last-write-wins
- `sync_operations` queue + 30s auto-sync
- Firestore + Storage security rules (deployed)
- `localUserId` replaces hardcoded `'local_user'` in repositories

### Milestone C — Reports & AI enhancement

- Share Report via native share sheet (plain text)
- Customer-visible summary section
- AI extraction history (last 5 runs, color-coded status)

### Polish

- UI/UX overhaul: design tokens, Ionicons, status-colored borders, empty
  states, settings screen, conditional Google SSO
- Signature canvas for customer approval
- Voice notes via `expo-av` (recording + playback + transcript)
- PDF generation via `expo-print` with native share
- Edit screens for all entity types
- Soft-delete UI on notes, materials, time entries, photos, jobs
- Pull-to-refresh + search/filter on job list
- `ErrorBoundary` wrapping auth gate
- `react-native-get-random-values` polyfill for `uuid` v14
- 112 unit + repository tests across 4 suites

### CI

- GitHub Actions: TypeScript, ESLint, iOS export check
