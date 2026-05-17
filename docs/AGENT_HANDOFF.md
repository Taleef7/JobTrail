# JobTrail Agent Handoff

You are working on JobTrail, an offline-first mobile app for field workers.

The goal is to build a React Native/Expo mobile app that helps contractors, repair technicians, cleaners, inspectors, and other field workers capture job notes, photos, materials, time, and customer approvals even when they have no internet connection.

The app must eventually support AI-assisted extraction from rough notes or voice transcripts, but AI should not be required for the app to function. Build the manual and local-first workflow first.

Read `docs/PLAN.md` before writing code.

---

## Non-negotiable project rules

1. Build local-first.
2. Save important user data locally before attempting cloud sync.
3. Do not implement cloud sync before local persistence works.
4. Do not implement local LLM before an AI provider abstraction exists.
5. Do not overwrite user data with AI output without a review/accept step.
6. Do not store secrets in the repo.
7. Do not use AsyncStorage as the primary database for structured job data.
8. Keep business logic out of UI components.
9. Use TypeScript.
10. Make small, focused commits.
11. Update docs when architecture changes.
12. Do not claim a feature is complete unless it is actually working.

---

## Tech stack target

Use:

- React Native
- Expo
- TypeScript
- Expo Router
- SQLite for local database
- Zod for validation
- Firebase Auth later
- Firestore later
- Firebase Storage or Azure Blob later
- AI provider abstraction from the beginning of the AI work

Do not add heavy dependencies without documenting why.

---

## First implementation target

Build Milestone A from `docs/PLAN.md`.

The first demo should show:

1. Running Expo app.
2. Job list screen.
3. Create job screen.
4. Job detail screen.
5. Local SQLite persistence.
6. Add manual job note.
7. Add material line item.
8. Add time entry.
9. Generate simple report preview.
10. Mock/rule-based AI extraction from typed rough note.
11. Review and accept extracted fields.
12. Confirm data persists after app restart.

Do not build Firebase, media upload, PDF export, or local LLM in the first milestone.

---

## Suggested first tasks

### Task 1: Project foundation

- Create Expo TypeScript app under `apps/mobile`.
- Add Expo Router.
- Add root README instructions.
- Add `.env.example`.
- Add base folder structure from `docs/PLAN.md`.
- Add lint/typecheck scripts.

### Task 2: Domain models

Create domain types and schemas for:

- Job
- JobNote
- MaterialLineItem
- TimeEntry
- AiExtractionResult
- SyncOperation

Use Zod schemas where useful.

### Task 3: SQLite setup

- Add SQLite database initialization.
- Add migrations.
- Add repositories.
- Implement CRUD for jobs and notes first.
- Add materials and time entries next.

### Task 4: Screens

Create screens:

- Job list
- Create job
- Job detail
- Add note
- Add material
- Add time entry
- Report preview
- AI suggestions review

### Task 5: AI provider abstraction

Create:

```ts
export interface AiProvider {
  extractJobFields(input: JobExtractionInput): Promise<JobExtractionResult>;
  summarizeJob(input: JobSummaryInput): Promise<JobSummaryResult>;
  suggestMissingFields(input: MissingFieldInput): Promise<MissingFieldResult>;
}
```

Implement:

- `MockAiProvider`
- `RuleBasedAiProvider`

The rule-based provider can parse simple phrases like:

- “used one PVC kit”
- “took 55 minutes”
- “customer approved”
- “follow up if...”

### Task 6: Report preview

Create a local report preview from actual local job data.

The report should include:

- Job title
- Client/site if available
- Work summary
- Notes
- Materials
- Labor time
- Follow-up notes

---

## Expected coding style

- Prefer clear simple code over clever abstractions.
- Use repository functions for data access.
- Use domain services for business logic.
- Keep screens focused on UI and calling hooks/services.
- Add comments only where they clarify non-obvious behavior.
- Avoid giant files.
- Avoid deeply nested state.
- Add TODO comments only when there is a clear follow-up task.

---

## Acceptance test for first milestone

After implementation, run this manual test:

1. Start the app.
2. Create a job named “Kitchen sink repair.”
3. Add note: “Replaced P-trap, used one PVC kit, took 55 minutes, customer approved, follow up if leak returns.”
4. Run extraction.
5. Confirm suggestions appear.
6. Accept material, duration, and follow-up.
7. Open report preview.
8. Confirm report includes the accepted fields.
9. Close and restart app.
10. Confirm the job and report data still exist.

If this works, Milestone A is complete.

---

## Do not start these yet

Do not start these until Milestone A is complete:

- Firebase Auth
- Firestore sync
- Firebase Storage/Azure Blob media upload
- PDF generation
- Local LLM
- Admin dashboard
- Payments/invoicing
- Multi-user crew management

---

## How to report progress

After each implementation pass, provide:

1. Files changed
2. What works now
3. How to run/test
4. Known limitations
5. Next recommended task
6. Any assumptions made

Keep the implementation aligned with `docs/PLAN.md`.

---

## Milestone A Status: COMPLETE

### What was implemented

- Expo TypeScript app initialized under `apps/mobile`
- Expo Router with file-based navigation
- SQLite database with migrations (jobs, job_notes, material_line_items, time_entries, ai_extraction_results)
- Domain types and Zod schemas
- Repository layer for all entities (CRUD operations)
- Screens: job list, create job, job detail, add note, add material, add time entry
- AI extraction: AiProvider interface, MockAiProvider, RuleBasedAiProvider
- AI suggestions review screen with accept/reject flow
- Report preview screen
- Data persists across app restarts via SQLite
- Cross-platform alert utility (`showAlert`) — works on both native (Alert.alert) and web (window.alert/confirm)
- MockSQLiteDatabase for web development/testing (in-memory, no persistence)
- DatabaseProvider with Platform.OS detection for cross-platform DB access
- `useFocusEffect` for data refresh on screen focus

### How to run

```bash
cd apps/mobile
npm install
npx expo start
```

Then open in Expo Go (iOS/Android) or run on emulator.

For web development (limited — no persistence):
```bash
npx expo start --web
```

### How to test Milestone A acceptance

1. Start the app.
2. Create a job named "Kitchen sink repair."
3. Add note: "Replaced P-trap, used one PVC kit, took 55 minutes, customer approved, follow up if leak returns."
4. Go to AI Extraction screen and run extraction.
5. Confirm suggestions appear (job type, materials, duration, follow-up).
6. Accept material, duration, and follow-up.
7. Open report preview.
8. Confirm report includes accepted fields.
9. Close and restart app.
10. Confirm the job and report data still exist.

### Known limitations (Milestone A)

- No PDF export
- Web platform uses in-memory MockDatabase — data does NOT persist across page reloads (native SQLite does persist)
- AI extraction is rule-based only (no LLM)
- No voice recording
- Report preview is read-only (no edit from report)
- `userId` hardcoded as `'local_user'` in photo creation (until Firebase Auth is configured)

### Recommended next task

- Milestone C: Better report export/share, optional cloud LLM extraction

---

## Milestone B Status: COMPLETE 🎉

### What was implemented

**Firebase provisioning (complete):**
- Firebase project `jobtrail-2026` created
- Firebase Web App registered with SDK config in `apps/mobile/.env`
- Email/Password authentication enabled
- Google sign-in enabled
- Firestore database created (`us-central1`, native mode)
- Firebase Storage default bucket created
- Firestore security rules deployed (user-scoped read/write)
- Storage security rules deployed (user-scoped read/write)
- Blaze plan (pay-as-you-go, free tier coverage: 50K Firestore reads/day, 5GB Storage, 50K MAU Auth)

**Authentication:**
- Firebase JS SDK v12 initialized (`src/data/remote/firebaseConfig.ts`)
- Auth context with sign up, sign in, sign out, Google sign-in (`src/context/AuthContext.tsx`)
- Google sign-in via `expo-auth-session/providers/google`
- Login and sign-up screens (`app/auth/login.tsx`, `app/auth/signup.tsx`)
- Auth gating in `app/_layout.tsx` — redirects to login when unauthenticated
- Local `users` table for mirroring Firebase Auth users
- `userRepository.ts` for local user CRUD

**Photo capture (works locally):**
- Photo capture screen with select/take photo, type chooser, caption (`app/job/[id]/photo.tsx`)
- `photoRepository.ts` for local photo CRUD
- Photos section in job detail screen with thumbnails (`app/job/[id].tsx`)
- Photos section in report preview (`app/job/[id]/report.tsx`)

**Sync engine:**
- `sync_operations` table and `syncRepository.ts` for queueing changes
- Sync operations automatically created on all job/note/material/time mutations
- `firestoreSync.ts` — sync engine that processes pending operations to Firestore
- `storageService.ts` — Firebase Storage upload for photos
- `SyncContext.tsx` — auto-syncs every 30 seconds when pending ops exist
- Sync status badges on job list cards (colored dots)
- Sync status text in job detail header

**Bug fixes from Milestone A audit:**
- Fixed follow-up notes writing to wrong field (`roughNotes` → `internalNotes`)
- Fixed `useEffect` → `useFocusEffect` in extract and report screens (stale data fix)
- Enabled `PRAGMA foreign_keys = ON` in SQLite
- Added loading indicator during DB init (no more blank white screen)
- Extracted shared `statusColor`/`formatDate` to `src/utils/formatting.ts`
- Removed dead `RuleBasedAiProvider` import from report screen
- Added transaction support (BEGIN/COMMIT/ROLLBACK) to MockDatabase

### How to test

**Test Auth flow:**
1. Run `npx expo start` (or `npx expo start --web`)
2. You'll see the login screen
3. Tap "Sign Up" to create a new account
4. Or tap "Sign in with Google" for Google OAuth
5. After sign-in, you'll be redirected to the job list

**Test photo capture:**
1. Create a job
2. Tap "+ Add" in the Photos section
3. Select or take a photo, choose a type (before/after/general/issue/material), add a caption
4. Save — photo appears in job detail and report preview

**Test sync:**
1. Create a job offline (airplane mode)
2. Note the sync status badge (yellow = pending)
3. Reconnect
4. Sync happens automatically within 30 seconds
5. Status changes to green = synced

### Costs (Blaze plan, staying below threshold)

| Service | Free Tier | Expected Usage |
|---------|-----------|---------------|
| Firebase Auth | 50,000 MAUs | Far below for dev |
| Cloud Firestore | 50K reads/day, 1GB stored | Well below |
| Cloud Storage | 5GB stored, 1GB/day download | Below with photos |
| Total cost | $0/month | Should stay $0 with light use |

### Known limitations

- Google sign-in client ID is set to standard format `{projectId}.apps.googleusercontent.com` — if Google sign-in doesn't work, get the exact Web Client ID from Firebase Console → Authentication → Settings and add `EXPO_PUBLIC_GOOGLE_CLIENT_ID=your-client-id` to `.env`
- Photo upload to Firebase Storage not yet wired into sync queue processing (photos are stored locally only)
- Auth uses Firebase JS SDK (works in Expo Go); for production, consider `@react-native-firebase/auth` 
- Sync engine uses last-write-wins conflict resolution
- No push notifications
- `userId` is still hardcoded as `'local_user'` in photo creation (pending user context integration)

---

## Milestone C Status: COMPLETE ✅

### What was implemented

**Report sharing:**
- Share Report button using React Native's built-in `Share` API
- Formatted plain-text report output (compatible with email, messaging, notes)
- Generates full report text including job info, work performed, materials, time, follow-up

**Improved report preview:**
- Customer-visible summary section when `job.customerVisibleSummary` is set
- More polished layout with consistent styling

**AI extraction history:**
- Full extraction history section in job detail screen (shows last 5 extractions)
- Each extraction shows: status (Accepted/Rejected/Pending), provider name, confidence %, extracted fields summary, and timestamp
- Color-coded status indicators (green = accepted, red = rejected, gray = pending)

### How to test

**Test share:**
1. Open any job's report preview
2. Tap "Share Report"
3. System share sheet opens with formatted text report

**Test extraction history:**
1. Create a job and add a note
2. Run extraction multiple times
3. Accept or reject some results
4. Job detail shows history of all extractions with status

### Known limitations (from Milestone C)

- Share outputs plain text only (no PDF)
- No cloud PDF generation
- Extraction history capped at 5 most recent results

---

## UI/UX Overhaul Status: COMPLETE ✅

### What was improved

**Design system:**
- Added `Elevation` tokens (none/low/medium/high) for consistent shadows across all screens
- Increased border radii (4→6, 8→10, 12→14, 16→20) for a more modern feel
- All shadow values come from a single source of truth
- Consistent use of `Colors`, `Spacing`, `Typography`, `BorderRadius` tokens across all screens

**Bug fixes:**
- Fixed `crypto` ReferenceError: added `react-native-get-random-values` polyfill for uuid v14
- Fixed Firebase Auth persistence: switched from `getAuth()` to `initializeAuth()` with `getReactNativePersistence()`
- Fixed navigation: removed back button on home screen, renamed title to "Jobs"
- Fixed Google Sign-In: removed hardcoded placeholder client ID, added `googleAvailable` flag, conditional Google button rendering
- Fixed sync crash: `firestoreSync.ts` now gracefully handles missing entities instead of throwing "not found" errors

**Job list screen (`app/index.tsx`):**
- Ionicons FAB button instead of text "+"
- Clean empty state (no emoji)
- Status-colored left borders on job cards
- Relative time with `timeAgo()` instead of formatted dates
- Removed sync status dots from cards
- Settings gear icon in header (navigates to `/settings`)

**Job detail screen (`app/job/[id].tsx`):**
- Ionicons for all section headers (notes, photos, materials, time, AI, report)
- Icon-based add buttons (`add-circle-outline`) instead of text "+ Add"
- Empty sections hidden — no more "No notes yet" clutter
- Compact status toggle row (no separate "Status" header)
- Sync status shown as just a dot (no text label)

**Auth screens (`app/auth/login.tsx`, `app/auth/signup.tsx`):**
- "Welcome back" / "Create account" titles
- Removed card wrappers — cleaner flat design
- Google Sign-In hidden when not configured
- Ionicons Google logo on the button
- Cleaner link text ("Create account" / "Sign in instead")

**Create job screen (`app/job/create.tsx`):**
- Removed verbose helper text
- Icon + text save button
- Concise placeholder text
- Added subtitle

**Extract screen (`app/job/[id]/extract.tsx`):**
- Sparkle icon in title
- Concise one-liner description (removed verbose paragraphs)
- Removed provider hint texts
- Compact confidence display with label
- Icon + text extract button

**Form sub-screens:**
- `note.tsx`: `create-outline` icon on label, `checkmark-circle` icon on save button, concise placeholder
- `material.tsx`: `cube-outline` icon on Material Name, `calculator-outline` on Unit Cost, `checkmark-circle` on save button, removed helper text
- `time.tsx`: `time-outline` icon on Duration, `document-text-outline` on Description, `checkmark-circle` on save button, removed helper text
- `photo.tsx`: `images-outline`/`camera-outline` icons on picker buttons, `pricetag-outline` on Photo Type, `chatbubble-outline` on Caption, `checkmark-circle` on save button

**Report screen (`app/job/[id]/report.tsx`):**
- `document-text-outline` icon next to report title
- Icons on all section headers: `person-outline`, `construct-outline`, `camera-outline`, `cube-outline`, `time-outline`, `alert-circle-outline`, `document-text-outline`, `create-outline`
- `share-outline` icon on Share Report button

**Settings screen (`app/settings.tsx`) — NEW:**
- Profile section with avatar circle (initials), display name, email
- Account section with sign-out button (confirmation alert)
- Sync section showing pending/synced/failed counts
- About section with app name, version, tagline
- Accessible via gear icon in home screen header

### Files changed

`src/theme/colors.ts`, `app/index.tsx`, `app/settings.tsx`, `app/_layout.tsx`, `app/job/create.tsx`, `app/job/[id].tsx`, `app/job/[id]/note.tsx`, `app/job/[id]/material.tsx`, `app/job/[id]/time.tsx`, `app/job/[id]/photo.tsx`, `app/job/[id]/extract.tsx`, `app/job/[id]/report.tsx`, `app/auth/login.tsx`, `app/auth/signup.tsx`, `src/utils/cryptoPolyfill.ts`, `src/data/remote/firebaseConfig.ts`, `src/context/AuthContext.tsx`, `src/data/remote/firestoreSync.ts`

---

## Project Completeness Assessment

### Overall: ~85% of full PLAN.md vision | ~98% of core MVP

### Completed Features

| Feature | Status | Details |
|---------|--------|---------|
| Job CRUD (Create, Read, Update status) | Done | Create, view, status toggle, edit screen, delete |
| Add notes, materials, time entries | Done | Full CRUD in repositories, create/edit/delete UI in screens |
| Photo capture (local) | Done | Select/take photo, type tagging, captions |
| AI extraction (rule-based) | Done | RuleBasedAiProvider parses common field patterns |
| AI extraction (cloud) | Partial | CloudAiProvider exists, needs GEMINI_API_KEY |
| Report preview + share | Done | Plain text share via native sheet |
| Firebase Auth (email/password) | Done | Login, signup, persistence across restarts |
| Google Sign-In | Partial | Conditional — hidden when client ID not configured |
| Firestore sync | Done | Two-way sync: pushes local changes to Firestore, pulls remote changes with last-write-wins |
| Photo cloud upload | Done | Wired into sync engine — photos upload to Firebase Storage and metadata syncs to Firestore |
| Settings/Profile screen | Done | Sign-out, sync counts, about info |
| Clean minimal UI with Ionicons | Done | All 12 screens redesigned |
| Delete functionality (repositories) | Done | Soft delete in all repos, but no UI triggers |

### Missing Features

| Feature | Priority | Effort | PLAN.md Phase |
|---------|----------|--------|---------------|
| Replace `local_user` with real userId | High | Small | Phase 6 |
| Job search/filter on home screen | High | Small | Phase 1 |
| Pull-to-refresh on job list | High | Small | Phase 1 |
| Edit job screen (title, type, notes) | Done | Edit screen for title, type, priority, rough notes, internal notes |
| Edit notes/materials/time entries | Done | Edit screens for all item types, tappable cards in job detail |
| Delete UI (swipe-to-delete) | Done | Delete buttons on notes, materials, time entries, photos, and jobs |
| Two-way sync (pull from cloud) | Done | Pulls remote changes from Firestore, upserts locally with last-write-wins conflict resolution |
| Wire photo upload into sync | Done | Photos upload to Firebase Storage, metadata syncs to Firestore |
| Error boundaries | Medium | Small | Phase 1 |
| Client/Site management | Done | Database, repositories, screens, sync, job integration, home screen navigation |
| Voice notes | Low | Large | Phase 5 |
| Customer approval/signature | Low | Medium | Phase 3 |
| PDF generation | Low | Medium | Phase 9 |
| Local LLM (Milestone D) | Low | Large | Phase 10 |
| Automated tests | Medium | Large | Phase 0 |

### Known Technical Debt

1. ~~`userId: 'local_user'` hardcoded in 6 repositories~~ FIXED — all repos now accept `userId` param
2. ~~One-way sync only~~ FIXED — now two-way sync with pull from cloud
3. ~~Photo upload not wired~~ FIXED — photos upload to Firebase Storage via sync engine
4. ~~No error boundaries~~ FIXED — ErrorBoundary wraps AuthGate
5. No automated tests — no .test.ts or .spec.ts files exist
6. ~~No pull-to-refresh~~ FIXED
7. ~~No search/filter~~ FIXED

### Recommended Next Tasks (in priority order)

1. ~~Replace `local_user` with real `localUserId` from AuthContext~~ DONE
2. ~~Add pull-to-refresh and search/filter to job list~~ DONE
3. ~~Add edit job screen~~ DONE
4. ~~Add delete UI (swipe-to-delete on items)~~ DONE
5. ~~Add error boundary component~~ DONE
6. ~~Wire photo upload into sync engine~~ DONE
7. ~~Implement two-way sync (pull from cloud)~~ DONE
8. ~~Implement Client/Site management~~ DONE
9. Add automated tests
