You are implementing JobTrail.

JobTrail is an offline-first React Native/Expo mobile app for field workers such as contractors, repair technicians, cleaners, inspectors, HVAC/plumbing/electrical workers, and small crews. The app helps users capture job notes, photos, materials, labor time, and customer approvals while working in unreliable connectivity environments. The app should later use AI to convert rough voice/text notes into structured job records and professional reports, but the first milestone must focus on a reliable local-first workflow.

Read and follow:

- `docs/PLAN.md`
- `docs/AGENT_HANDOFF.md`

Start with Milestone A only.

Your first objective is to create a working local-first vertical slice:

Create job locally -> add rough note -> run mock/rule-based extraction -> review suggestions -> accept material/time/follow-up fields -> view report preview -> restart app and confirm data persisted.

Use:

- React Native
- Expo
- TypeScript
- Expo Router
- SQLite for local persistence
- Zod for validation where helpful

Do not implement Firebase, Firestore, media upload, PDF export, or local LLM yet.

Repository expectations:

- Keep code organized under `apps/mobile`.
- Keep docs under `docs`.
- Create clear domain types.
- Use repository functions for local data access.
- Keep UI screens separate from business logic.
- Do not use AsyncStorage as the main database.
- Do not store secrets.
- Do not overwrite user data with AI output without a review/accept step.
- Make small, focused changes.
- Update docs when architecture changes.

Implementation order:

1. Initialize Expo TypeScript app if not already initialized.
2. Set up Expo Router and basic screens.
3. Add domain models and Zod schemas.
4. Add SQLite database initialization and migrations.
5. Add repositories for jobs, notes, materials, time entries, and AI extraction results.
6. Build job list, create job, job detail, add note, add material, add time entry, AI suggestions review, and report preview screens.
7. Add `AiProvider` interface.
8. Add `MockAiProvider`.
9. Add `RuleBasedAiProvider`.
10. Wire extraction to review/apply flow.
11. Ensure local data persists after app restart.
12. Add minimal tests or documented manual test steps.

Acceptance test:

1. Start the app.
2. Create a job named “Kitchen sink repair.”
3. Add note: “Replaced P-trap, used one PVC kit, took 55 minutes, customer approved, follow up if leak returns.”
4. Run extraction.
5. Confirm suggestions appear.
6. Accept material, duration, and follow-up.
7. Open report preview.
8. Confirm report includes accepted fields.
9. Close and restart app.
10. Confirm the job and report data still exist.

At the end, report:

- Files changed
- What works
- How to run it
- How to test Milestone A
- Known limitations
- Recommended next task
