# JobTrail Implementation Plan

Version: 0.1  
Project name: JobTrail  
Product type: Offline-first mobile field-work assistant  
Primary user: Independent contractors, field service workers, repair technicians, cleaners, inspectors, HVAC/electrical/plumbing workers, and small crews  
Primary value proposition: Turn field notes, photos, time, materials, and customer sign-off into clean job records and report-ready summaries, even when the worker has no internet connection.

---

## 1. Executive summary

JobTrail is a mobile-first, offline-first field-work documentation app. It is designed for workers who perform jobs away from a desk and often need to capture proof of work, job notes, photos, labor time, materials, expenses, and customer approvals while moving between sites.

The app should work even with poor or no connectivity. A user should be able to create a job, add voice notes, capture before/after photos, track time and materials, and generate a job summary without depending on a live backend. When connectivity returns, the local records should sync to the cloud and become available for backup, dashboarding, reporting, and future automation.

The AI layer should be helpful but not required for the app to function. The baseline app should allow manual entry. The AI layer should then enhance the workflow by converting rough voice notes into structured job records, generating summaries, suggesting missing fields, and eventually supporting on-device/local LLM inference for privacy and offline use.

The first production-quality MVP should focus on reliability, clean data modeling, offline persistence, and an excellent worker-facing capture flow. Do not begin with a complicated local LLM implementation. Build the app in layers.

---

## 2. Product vision

JobTrail should become a practical mobile assistant for field workers.

The worker should be able to say:

"I replaced the kitchen sink P-trap, used one PVC trap kit, job took 55 minutes, customer approved, follow up if leak returns."

JobTrail should turn that into:

- Job type: plumbing repair
- Work performed: replaced kitchen sink P-trap
- Materials used: one PVC trap kit
- Labor time: 55 minutes
- Customer approval: yes
- Follow-up note: monitor for leak return
- Report summary: professional, client-ready wording

The app should also let the worker attach before/after photos, record timestamps, track materials, collect a customer signature, and generate a clean report.

---

## 3. Core product principles

### 3.1 Offline-first, not offline-afterthought

JobTrail should treat the local device as the source of immediate truth. Every important action should write locally first.

Required behavior:

- User can create and edit jobs offline.
- User can add photos offline.
- User can add materials and notes offline.
- User can generate a local summary offline.
- User can see clear sync status for each record.
- Sync should happen automatically when internet returns.
- Failed sync should not lose data.

### 3.2 AI-assisted, not AI-dependent

The user must always be able to complete the workflow manually.

AI should help with:

- Extracting structured fields from voice/text notes
- Rewriting rough notes into professional summaries
- Suggesting missing information
- Classifying job type
- Creating report sections

AI should not block the user from saving, editing, or exporting records.

### 3.3 Minimal typing

The field worker is often in a truck, basement, job site, or customer location. The interface should support fast capture through:

- Big buttons
- Voice notes
- Photo capture
- Quick material entry
- Templates
- One-tap job status updates
- Auto-saved drafts

### 3.4 Audit-ready records

Every job record should preserve:

- Created timestamp
- Updated timestamp
- Device-local ID
- Cloud ID after sync
- Sync status
- Photos and metadata
- Manual edits
- AI-generated summaries
- Customer approval/signature, if collected

### 3.5 Professional output

The final result should not look like a rough note-taking app. It should produce a clean, shareable job report.

---

## 4. Target users and use cases

### 4.1 Primary user personas

#### Independent contractor

Needs to document jobs, send summaries, justify invoices, and track time/materials.

#### Small field service business owner

Needs records for multiple workers, jobs, clients, and repeat service calls.

#### Repair technician

Needs to record issue, diagnosis, fix, parts used, photos, and follow-up.

#### Cleaning or maintenance worker

Needs before/after proof, completion checklists, timestamps, and customer sign-off.

#### Inspector

Needs structured observations, photos, room/location tags, and exportable reports.

---

## 5. MVP scope

The MVP should prove the end-to-end workflow:

1. User signs up/logs in.
2. User creates a job.
3. User adds client/site information.
4. User adds job notes manually.
5. User records a voice note or enters rough text.
6. AI extraction converts rough notes into structured fields.
7. User adds before/after photos.
8. User tracks time and materials.
9. User generates a professional job summary.
10. User saves all data locally.
11. App syncs cloud records when online.
12. User can view job history and sync status.
13. User can export/share a basic report.

---

## 6. Non-goals for the first MVP

Do not build these in the first milestone unless the foundation is already stable:

- Multi-company admin dashboard
- Complex invoicing/payment system
- Full local LLM integration
- Advanced OCR
- Multi-user crew assignment
- Real-time collaboration
- Marketplace or customer portal
- Complex compliance/legal guarantees
- Full accounting integration
- Fully automated tax categorization
- Native app store release pipeline

These can be added later.

---

## 7. Recommended technical architecture

### 7.1 Preferred high-level stack

Mobile app:

- React Native
- Expo
- TypeScript
- Expo Router
- React Hook Form
- Zod for validation
- Zustand or TanStack Query for app state
- SQLite-based local persistence
- Optional Drizzle ORM for typed SQLite queries

Local persistence:

- Expo SQLite for MVP
- Consider WatermelonDB later if the app requires more complex sync or very large local datasets

Authentication:

- Firebase Auth

Cloud sync:

- Firestore for user/job metadata and lightweight structured records
- Firebase Storage or Azure Blob Storage for media files
- Optional Azure Functions for PDF generation/report processing

AI:

- Phase 1: deterministic parsing + cloud LLM fallback
- Phase 2: local small model proof-of-concept
- Phase 3: production-grade local model integration where feasible

Automation:

- Optional n8n/Make/Zapier later
- Example automation: when job report is finalized, email PDF to customer and update a Google Sheet/CRM

---

## 8. Why this architecture

React Native and Expo allow fast cross-platform development for Android and iOS while keeping the codebase manageable.

SQLite gives the app a durable local database that works without internet and persists across app restarts. This is better than using only in-memory state or AsyncStorage for structured job records.

Firebase Auth and Firestore provide a practical backend for authentication and cloud sync. Firestore already has offline persistence features, but for this app the local-first architecture should still maintain its own app-level sync state because job records, media files, AI outputs, and conflict handling require more control than basic cache behavior alone.

Azure can be added where it strengthens the project story:

- Azure Blob Storage for media/report storage
- Azure Functions for PDF generation
- Azure AI or Azure OpenAI as optional online summarization fallback
- Azure App Insights for telemetry
- Azure Static Web Apps or Azure Container Apps for a future dashboard

---

## 9. Architecture layers

### 9.1 Presentation layer

Responsibilities:

- Screens
- Forms
- Navigation
- UI state
- Capture flows
- Empty/error/loading states

Suggested folder:

```text
src/app/
src/components/
src/features/
src/theme/
```

### 9.2 Domain layer

Responsibilities:

- Business types
- Validation schemas
- Job status transitions
- Field extraction models
- Report models
- Sync state types

Suggested folder:

```text
src/domain/
```

### 9.3 Local data layer

Responsibilities:

- SQLite schema
- Migrations
- Repositories
- Local CRUD operations
- Sync queue
- Media metadata
- Durable drafts

Suggested folder:

```text
src/data/local/
```

### 9.4 Remote data layer

Responsibilities:

- Firebase Auth integration
- Firestore writes/reads
- Storage uploads
- Remote DTO mapping
- API clients

Suggested folder:

```text
src/data/remote/
```

### 9.5 Sync engine

Responsibilities:

- Determine pending local changes
- Upload records
- Upload media
- Pull remote updates
- Resolve conflicts
- Retry failed operations
- Maintain sync status

Suggested folder:

```text
src/sync/
```

### 9.6 AI layer

Responsibilities:

- Voice/transcript cleanup
- Field extraction
- Summary generation
- Missing-field suggestions
- Provider abstraction for local/cloud models

Suggested folder:

```text
src/ai/
```

---

## 10. Suggested repository structure

Use this structure from the beginning.

```text
jobtrail/
  README.md
  docs/
    PLAN.md
    AGENT_HANDOFF.md
    ARCHITECTURE.md
    DATA_MODEL.md
    SYNC_STRATEGY.md
    AI_STRATEGY.md
    MVP_SCOPE.md
    TESTING_STRATEGY.md
    DECISIONS/
      0001-tech-stack.md
      0002-offline-first-sync.md
      0003-ai-provider-abstraction.md

  apps/
    mobile/
      app/
      assets/
      src/
        ai/
          providers/
          prompts/
          extraction/
          summarization/
        app/
          auth/
          jobs/
          settings/
        components/
          ui/
          forms/
          media/
          jobs/
        data/
          local/
            migrations/
            repositories/
            schema/
          remote/
            firebase/
            storage/
        domain/
          entities/
          schemas/
          services/
        hooks/
        navigation/
        sync/
        theme/
        utils/
      package.json
      app.json
      tsconfig.json

  packages/
    shared/
      src/
        types/
        validation/
        constants/
      package.json

  scripts/
    seed-demo-data.ts
    reset-local-db.ts

  .github/
    workflows/
      mobile-ci.yml
    ISSUE_TEMPLATE/
```

If you want a simpler MVP repo at first, you may start with only:

```text
jobtrail/
  docs/
  app/
  src/
```

But the `apps/mobile` structure is more scalable and agent-friendly.

---

## 11. Data model

### 11.1 Entity overview

Core entities:

- UserProfile
- Job
- Client
- Site
- JobNote
- VoiceNote
- PhotoAsset
- MaterialLineItem
- TimeEntry
- Expense
- CustomerApproval
- Report
- SyncOperation
- AiExtractionResult

---

## 12. Local database schema

The exact schema can evolve, but the MVP should begin with stable tables.

### 12.1 users

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  cloud_uid TEXT,
  email TEXT,
  display_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_synced_at TEXT
);
```

### 12.2 clients

```sql
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  cloud_id TEXT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### 12.3 sites

```sql
CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id TEXT,
  cloud_id TEXT,
  name TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);
```

### 12.4 jobs

```sql
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  cloud_id TEXT,
  client_id TEXT,
  site_id TEXT,
  title TEXT NOT NULL,
  job_type TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  priority TEXT DEFAULT 'normal',
  scheduled_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  rough_notes TEXT,
  structured_summary TEXT,
  internal_notes TEXT,
  customer_visible_summary TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  ai_status TEXT DEFAULT 'not_started',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (site_id) REFERENCES sites(id)
);
```

### 12.5 job_notes

```sql
CREATE TABLE IF NOT EXISTS job_notes (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  note_type TEXT NOT NULL DEFAULT 'manual',
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  FOREIGN KEY (job_id) REFERENCES jobs(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### 12.6 voice_notes

```sql
CREATE TABLE IF NOT EXISTS voice_notes (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  local_audio_uri TEXT,
  duration_seconds INTEGER,
  transcript TEXT,
  transcript_source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  FOREIGN KEY (job_id) REFERENCES jobs(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### 12.7 photo_assets

```sql
CREATE TABLE IF NOT EXISTS photo_assets (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  local_uri TEXT NOT NULL,
  remote_url TEXT,
  photo_type TEXT NOT NULL DEFAULT 'general',
  caption TEXT,
  taken_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  upload_status TEXT NOT NULL DEFAULT 'pending',
  sync_status TEXT NOT NULL DEFAULT 'pending',
  FOREIGN KEY (job_id) REFERENCES jobs(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### 12.8 material_line_items

```sql
CREATE TABLE IF NOT EXISTS material_line_items (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  quantity REAL DEFAULT 1,
  unit TEXT,
  unit_cost REAL,
  total_cost REAL,
  billable INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  FOREIGN KEY (job_id) REFERENCES jobs(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### 12.9 time_entries

```sql
CREATE TABLE IF NOT EXISTS time_entries (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  duration_minutes INTEGER,
  description TEXT,
  billable INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  FOREIGN KEY (job_id) REFERENCES jobs(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### 12.10 customer_approvals

```sql
CREATE TABLE IF NOT EXISTS customer_approvals (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  customer_name TEXT,
  signature_local_uri TEXT,
  signature_remote_url TEXT,
  approved_at TEXT,
  approval_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  FOREIGN KEY (job_id) REFERENCES jobs(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### 12.11 ai_extraction_results

```sql
CREATE TABLE IF NOT EXISTS ai_extraction_results (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  provider TEXT NOT NULL,
  model_name TEXT,
  input_text TEXT NOT NULL,
  extracted_json TEXT NOT NULL,
  confidence REAL,
  created_at TEXT NOT NULL,
  accepted_at TEXT,
  rejected_at TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### 12.12 sync_operations

```sql
CREATE TABLE IF NOT EXISTS sync_operations (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  processed_at TEXT
);
```

---

## 13. Cloud data model

Use a user-scoped structure. Start simple.

```text
users/{uid}
  profile
  jobs/{jobId}
  clients/{clientId}
  sites/{siteId}
  reports/{reportId}
  syncMetadata/{deviceId}
```

For media:

```text
jobtrail/
  users/{uid}/jobs/{jobId}/photos/{photoId}.jpg
  users/{uid}/jobs/{jobId}/signatures/{approvalId}.png
  users/{uid}/jobs/{jobId}/reports/{reportId}.pdf
```

Each cloud document should contain:

```ts
{
  id: string;
  ownerUid: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  sourceDeviceId: string;
  localId?: string;
  version: number;
}
```

---

## 14. Sync strategy

### 14.1 Sync state values

Use clear sync states:

```ts
type SyncStatus =
  | "local_only"
  | "pending"
  | "syncing"
  | "synced"
  | "failed"
  | "conflict"
  | "deleted_pending";
```

### 14.2 Basic sync flow

Every local mutation should:

1. Write to SQLite immediately.
2. Mark affected entity as `pending`.
3. Create a row in `sync_operations`.
4. Continue UI flow without waiting for network.
5. Background sync processes pending operations when online.
6. On success, mark entity as `synced`.
7. On failure, retain local data and set operation to `failed` with retry metadata.

### 14.3 Upload order

Sync dependencies in this order:

1. User profile
2. Clients
3. Sites
4. Jobs
5. Job notes
6. Time entries
7. Material line items
8. Photo metadata
9. Photo binary uploads
10. Customer approvals
11. Reports

### 14.4 Conflict handling

For MVP:

- Use last-write-wins at field level for simple records.
- Preserve local changes if remote has newer version and local has unsynced edits.
- Mark as `conflict` only when both local and remote changed after last sync.
- Provide a simple conflict UI later.

For first implementation:

- Avoid multi-device editing complexity.
- Assume one primary device per user.
- Still build version fields so conflict handling can be improved later.

### 14.5 Media sync

Photos should be saved locally first.

Flow:

1. User captures image.
2. App stores local image URI.
3. App creates `photo_assets` row.
4. App displays image from local URI.
5. When online, upload image.
6. Store remote URL.
7. Mark upload status as `uploaded`.

Do not delete local media immediately after upload. Add a later setting for storage cleanup.

---

## 15. AI strategy

### 15.1 AI provider interface

Create an abstraction immediately so the app can switch between local, cloud, and mock providers.

```ts
export interface AiProvider {
  extractJobFields(input: JobExtractionInput): Promise<JobExtractionResult>;
  summarizeJob(input: JobSummaryInput): Promise<JobSummaryResult>;
  suggestMissingFields(input: MissingFieldInput): Promise<MissingFieldResult>;
}
```

Implement providers in this order:

1. `MockAiProvider`
2. `RuleBasedAiProvider`
3. `CloudAiProvider`
4. `LocalLlmAiProvider`

The app should depend only on `AiProvider`, not on a specific model.

### 15.2 Phase 1 AI: mock and rule-based extraction

Build initial AI features without depending on external APIs.

Example input:

```text
Replaced kitchen sink P-trap, used one PVC trap kit, took 55 minutes, customer approved, follow up if leak returns.
```

Example extracted output:

```json
{
  "jobType": "plumbing",
  "workPerformed": ["Replaced kitchen sink P-trap"],
  "materials": [
    {
      "name": "PVC trap kit",
      "quantity": 1,
      "unit": "kit"
    }
  ],
  "durationMinutes": 55,
  "customerApproved": true,
  "followUpNotes": ["Follow up if leak returns"],
  "confidence": 0.72
}
```

### 15.3 Phase 2 AI: cloud fallback

Add optional online AI for better extraction/summarization.

The cloud provider should:

- Use strict JSON schema output.
- Validate response with Zod.
- Never overwrite user data without confirmation.
- Store AI output in `ai_extraction_results`.
- Let user accept/reject extracted fields.

### 15.4 Phase 3 AI: local LLM proof-of-concept

The local LLM should be treated as an advanced feature.

Recommended initial local LLM task:

- Input: short job note transcript
- Output: structured JSON
- Max output length: small
- Temperature: low
- Context: minimal
- No long conversations

Do not use local LLM for:

- Huge reports
- Complex multi-step reasoning
- Legal/compliance conclusions
- Medical/safety advice
- Unbounded chat

### 15.5 Local LLM feasibility requirements

Before integrating local LLM into main app:

- Confirm target platform.
- Confirm device memory requirements.
- Confirm model file size and distribution method.
- Confirm app store implications.
- Confirm latency on at least one Android and one iOS device if possible.
- Add fallback behavior when local model is unavailable.

### 15.6 AI safety and reliability rules

AI outputs must be clearly reviewable. The app should say “Suggested fields” or “Draft summary,” not imply the AI is automatically correct.

Required behavior:

- User reviews extracted fields before applying.
- Original note/transcript remains stored.
- AI output is versioned.
- User can revert AI-generated edits.
- If AI fails, user can continue manually.

---

## 16. Voice note strategy

Voice support can be implemented in phases.

### 16.1 MVP voice support

Start with:

- Record audio note
- Save audio file locally
- User can manually type transcript or notes
- Later connect speech-to-text

### 16.2 Speech-to-text options

Possible approaches:

- Device OS speech-to-text where available
- Cloud speech-to-text when online
- Local transcription model later

Do not block the MVP on perfect transcription.

### 16.3 Voice-to-job flow

Screen flow:

1. Open job.
2. Tap “Add voice note.”
3. Record audio.
4. Save audio locally.
5. Transcribe if available.
6. Show editable transcript.
7. Tap “Extract job details.”
8. Show suggested fields.
9. User accepts selected fields.
10. Save structured updates.

---

## 17. UX and screen plan

### 17.1 Navigation structure

Main tabs:

- Jobs
- Capture
- Reports
- Settings

Alternative:

- Jobs
- Clients
- Sync
- Settings

For MVP, keep it simple:

```text
Auth
  Login
  Sign Up

Main
  Job List
  Job Detail
  Create/Edit Job
  Add Note
  Add Photo
  Add Materials
  Time Tracker
  Review AI Suggestions
  Report Preview
  Settings
```

### 17.2 Job list screen

Requirements:

- Search jobs
- Filter by status
- Show sync status
- Show last updated timestamp
- Show client/site
- Floating action button to create job

Job card should show:

- Title
- Client or site
- Status
- Date
- Sync badge
- Photo count
- Notes count

### 17.3 Create job screen

Fields:

- Job title
- Client name
- Site/address
- Job type
- Scheduled date/time
- Initial note

Allow save as draft.

### 17.4 Job detail screen

Sections:

- Overview
- Notes
- Photos
- Time
- Materials
- AI suggestions
- Report
- Approval

Primary actions:

- Add note
- Record voice
- Add photo
- Start timer
- Add material
- Generate summary
- Mark complete

### 17.5 AI suggestions screen

Display extracted fields as editable suggestions.

Example:

```text
Suggested job type: Plumbing
Suggested material: PVC trap kit, quantity 1
Suggested duration: 55 minutes
Suggested follow-up: Check if leak returns
```

User can:

- Accept all
- Accept selected
- Edit before applying
- Reject
- Save AI result for history

### 17.6 Report preview screen

Show client-ready report:

- Header
- Client/site
- Job date
- Work performed
- Materials used
- Time spent
- Before/after photos
- Follow-up notes
- Customer approval/signature

MVP export:

- Share plain text
- Generate simple PDF if feasible
- Email/share using native share sheet

---

## 18. Report format

### 18.1 Basic report sections

```text
JobTrail Job Report

Job:
Client:
Site:
Date:
Technician:

Work performed:
[Summary]

Materials used:
[Items]

Labor time:
[Duration]

Photos:
[Before/After references]

Customer approval:
[Approved by / date]

Follow-up:
[Notes]
```

### 18.2 Report generation strategy

Phase 1:

- Generate report preview in app as structured text/HTML-like layout.
- Use native sharing.

Phase 2:

- Generate PDF locally if possible.

Phase 3:

- Generate polished PDF through cloud function.

---

## 19. Authentication and authorization

### 19.1 MVP auth requirements

- Email/password sign up
- Email/password login
- Logout
- Current user session persistence
- User-scoped local records
- User-scoped cloud records

### 19.2 Security requirements

- A user can only access their own records.
- Firestore rules must enforce `ownerUid == request.auth.uid`.
- Storage rules must enforce user path ownership.
- Do not expose service keys in the mobile app.
- Do not store sensitive secrets in the repo.

---

## 20. Environment configuration

Use `.env.example`.

Example:

```env
EXPO_PUBLIC_FIREBASE_API_KEY=
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=
EXPO_PUBLIC_FIREBASE_PROJECT_ID=
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
EXPO_PUBLIC_FIREBASE_APP_ID=

EXPO_PUBLIC_AI_MODE=mock
EXPO_PUBLIC_ENABLE_LOCAL_LLM=false
EXPO_PUBLIC_ENABLE_CLOUD_AI=false
```

Do not commit real `.env` files.

---

## 21. Testing strategy

### 21.1 Unit tests

Test:

- Domain schemas
- Job status transitions
- AI parser
- Report formatter
- Sync queue logic
- Date/time utilities

### 21.2 Integration tests

Test:

- SQLite repository CRUD
- Job creation with notes/photos/materials
- Sync operation creation after local mutation
- AI extraction result saved and accepted

### 21.3 Offline behavior tests

Manual and automated tests should cover:

- Create job in airplane mode
- Add note offline
- Add photo offline
- Restart app offline and verify data persists
- Reconnect and verify sync
- Failed upload retry
- Duplicate sync prevention

### 21.4 UI tests

Eventually test:

- Login
- Create job
- Add note
- Add material
- Generate summary
- View report

---

## 22. Acceptance criteria for MVP

The MVP is acceptable when:

- User can sign up and log in.
- User can create a job.
- Job saves locally.
- Job survives app restart.
- User can add manual notes.
- User can add photos.
- User can add material line items.
- User can track basic labor time.
- User can generate a client-ready text summary.
- AI provider abstraction exists.
- Mock/rule-based AI extraction works.
- User can accept/reject extracted fields.
- Sync queue exists.
- Basic cloud sync works for jobs and notes.
- Media upload is either implemented or clearly stubbed.
- App shows sync state.
- Basic tests exist for data model, local persistence, and AI extraction.
- Documentation explains architecture and next steps.

---

## 23. Implementation phases

### Phase 0: Repository foundation

Goal: Create a professional project foundation.

Tasks:

- Initialize repository.
- Add README.
- Add docs folder.
- Add this `PLAN.md`.
- Add `AGENT_HANDOFF.md`.
- Add architecture decision records.
- Initialize Expo React Native TypeScript app.
- Configure linting/formatting.
- Add basic CI if feasible.
- Add `.env.example`.
- Add issue templates.

Deliverables:

- Repo structure
- Running mobile app shell
- Documentation baseline

Acceptance criteria:

- `npm install` works.
- `npm run start` works.
- README explains how to run app.
- Docs folder exists and is committed.

---

### Phase 1: App shell and navigation

Goal: Build the mobile skeleton.

Tasks:

- Set up Expo Router.
- Create auth stack.
- Create main app layout.
- Create job list screen.
- Create create job screen.
- Create job detail screen.
- Create settings screen.
- Add placeholder UI components.
- Add theme tokens.

Deliverables:

- Navigable mobile app
- Clean empty states
- Basic design system

Acceptance criteria:

- User can navigate between screens.
- UI is coherent.
- No fake business logic hidden inside screens.

---

### Phase 2: Local database foundation

Goal: Make the app truly local-first.

Tasks:

- Add SQLite setup.
- Add migrations.
- Implement core tables.
- Implement repositories.
- Add local ID generation.
- Add timestamps.
- Add soft delete fields.
- Add sync status fields.
- Add seed/demo data script.

Deliverables:

- Local database module
- Job repository
- Client/site repository if included
- Material/time/note repository

Acceptance criteria:

- Create/read/update/delete job locally.
- Add notes locally.
- Add materials locally.
- Add time entry locally.
- Data persists after app restart.

---

### Phase 3: Job workflow MVP

Goal: Build the real user workflow.

Tasks:

- Create job form.
- Job detail overview.
- Add note flow.
- Add material flow.
- Start/stop time tracking.
- Job status updates.
- Job search/filter.
- Local report preview.

Deliverables:

- Complete manual job documentation flow

Acceptance criteria:

- User can complete a job record manually without AI.
- Report preview uses actual local data.
- No network required.

---

### Phase 4: Media capture

Goal: Add proof-of-work photos.

Tasks:

- Add camera/image picker.
- Save local image URI.
- Add photo metadata to SQLite.
- Display photo gallery in job detail.
- Add photo type: before, after, general, issue, material.
- Add captions.
- Preserve photos offline.

Deliverables:

- Local photo capture and gallery

Acceptance criteria:

- User can attach photos to jobs offline.
- Photos remain visible after app restart.
- Photo metadata is associated with correct job.

---

### Phase 5: AI provider abstraction and mock extraction

Goal: Build AI architecture without blocking on models.

Tasks:

- Create AI provider interface.
- Create mock provider.
- Create rule-based provider.
- Create extraction schema with Zod.
- Add “Extract from note” action.
- Add AI suggestions review screen.
- Store AI extraction result.
- Apply accepted suggestions to job/material/time records.

Deliverables:

- Reviewable AI extraction workflow

Acceptance criteria:

- User can enter rough note and get structured suggestions.
- User can accept/reject suggestions.
- Original note remains intact.
- AI output is stored.

---

### Phase 6: Authentication

Goal: Add user accounts.

Tasks:

- Configure Firebase project.
- Add Firebase Auth.
- Build sign up/login/logout.
- Store local user profile.
- Scope local data by user ID.
- Add basic auth state loading.

Deliverables:

- Authenticated app

Acceptance criteria:

- User can sign up and log in.
- User can log out.
- Local records are associated with authenticated user.

---

### Phase 7: Cloud sync MVP

Goal: Sync local data to cloud.

Tasks:

- Add Firestore config.
- Define cloud DTOs.
- Implement upload for jobs.
- Implement upload for notes/materials/time entries.
- Implement sync queue processing.
- Add sync status UI.
- Add retry behavior.
- Add basic pull from cloud if feasible.
- Add Firestore security rules.

Deliverables:

- Working local-to-cloud sync

Acceptance criteria:

- User can create job offline.
- When online, job syncs to Firestore.
- Sync status updates correctly.
- Failed sync does not lose data.

---

### Phase 8: Media upload sync

Goal: Sync images safely.

Tasks:

- Configure Firebase Storage or Azure Blob Storage.
- Implement image upload worker.
- Store remote URL after upload.
- Retry failed uploads.
- Keep local file reference.
- Update report to include uploaded media URLs where available.

Deliverables:

- Cloud media backup

Acceptance criteria:

- Locally captured images upload when online.
- Upload failure does not break job record.
- UI distinguishes pending/uploaded/failed media.

---

### Phase 9: Report export

Goal: Make JobTrail output useful.

Tasks:

- Build report preview.
- Build shareable text output.
- Add basic PDF generation if feasible.
- Add native share sheet.
- Optional: cloud function PDF generation.

Deliverables:

- Shareable report

Acceptance criteria:

- User can generate a professional job report.
- Report includes actual job data.
- Report can be shared/exported.

---

### Phase 10: Local LLM proof-of-concept

Goal: Demonstrate local AI feasibility without destabilizing MVP.

Tasks:

- Add feature flag for local LLM.
- Research target runtime.
- Add prototype provider.
- Bundle or download a small test model outside the main flow.
- Test extraction on short notes.
- Log latency and device behavior.
- Add fallback to rule/cloud provider.

Deliverables:

- Experimental local AI provider

Acceptance criteria:

- Local model can process a short job note on at least one test device.
- App still works if local model is unavailable.
- Feature can be disabled from environment/config.

---

## 24. Suggested Git branching strategy

Use small branches:

```text
main
feature/project-foundation
feature/mobile-shell
feature/local-db
feature/job-workflow
feature/media-capture
feature/ai-extraction
feature/auth
feature/cloud-sync
feature/report-export
experiment/local-llm
```

Each branch should:

- Have a clear scope
- Include tests where relevant
- Update docs if architecture changes
- Avoid unrelated refactors

---

## 25. Code quality rules for the agent

The development agent must follow these rules:

1. Do not make large unrelated changes.
2. Do not implement cloud sync before local persistence works.
3. Do not implement local LLM before AI provider abstraction exists.
4. Do not store secrets in the repo.
5. Do not use AsyncStorage as the primary database for structured job data.
6. Do not overwrite user data with AI output without review.
7. Do not assume internet is available.
8. Do not hide business logic inside UI components.
9. Do not create fake completed features.
10. Always update documentation when architecture changes.
11. Prefer small, testable modules.
12. Use TypeScript strictly where feasible.
13. Keep UI flows simple and worker-friendly.
14. Every local mutation should create or update sync metadata.
15. Every media record should survive app restart before upload.

---

## 26. Initial agent task list

The first agent should begin with these tasks in order.

### Task 1: Create repository foundation

- Create project structure.
- Add README.
- Add docs.
- Add `.env.example`.
- Add basic package scripts.
- Add architecture decision record template.

### Task 2: Initialize Expo app

- Create Expo TypeScript app in `apps/mobile`.
- Add Expo Router.
- Add basic theme.
- Add placeholder screens.

### Task 3: Add domain models

Create TypeScript types and Zod schemas for:

- Job
- Client
- Site
- JobNote
- PhotoAsset
- MaterialLineItem
- TimeEntry
- AiExtractionResult
- SyncOperation

### Task 4: Add local database

- Configure SQLite.
- Add migrations.
- Add repository pattern.
- Implement job CRUD.
- Implement note CRUD.
- Add tests if possible.

### Task 5: Build basic job UI

- Job list
- Create job
- Job detail
- Add note
- Add material
- Add time entry
- Report preview

### Task 6: Add AI provider abstraction

- Add interface.
- Add mock provider.
- Add rule-based parser.
- Add review/apply flow.

Only after these are complete should the agent move to auth and cloud sync.

---

## 27. Detailed first implementation milestone

### Milestone A: Foundation and local job capture

This should be the first working demo.

Scope:

- Running Expo app
- Local SQLite database
- Job list
- Create job
- Job detail
- Add note
- Add material
- Add time entry
- Report preview
- Mock/rule-based AI extraction from typed note

Do not include:

- Firebase Auth
- Firestore sync
- Image upload
- Local LLM
- PDF export

Acceptance demo:

1. Start the app.
2. Create a job called “Kitchen sink repair.”
3. Add rough note: “Replaced P-trap, used one PVC kit, took 55 minutes, customer approved.”
4. Run extraction.
5. Accept suggested material and duration.
6. View report preview.
7. Restart app.
8. Confirm job still exists.

---

## 28. Detailed second implementation milestone

### Milestone B: Photos, auth, and cloud sync

Scope:

- Firebase Auth
- User-scoped local data
- Firestore job sync
- Photo capture
- Local photo persistence
- Media upload
- Sync status badges

Acceptance demo:

1. Login.
2. Create a job offline.
3. Add photos offline.
4. Reconnect.
5. Sync job and photos.
6. Confirm cloud records exist.
7. Open app again and see synced status.

---

## 29. Detailed third implementation milestone

### Milestone C: Reports and AI enhancement

Scope:

- Better report preview
- Share/export report
- Optional cloud PDF generation
- Optional cloud LLM extraction
- Improved prompts
- AI result history

Acceptance demo:

1. Create a realistic job record.
2. Generate professional customer-visible summary.
3. Export/share report.
4. Show original note, AI suggestion, and final accepted version.

---

## 30. Detailed fourth implementation milestone

### Milestone D: Local AI experiment

Scope:

- Local model provider behind feature flag
- Short note extraction only
- Latency logging
- Fallback provider
- Device capability check

Acceptance demo:

1. Enable local AI flag.
2. Enter a short job note.
3. Run local extraction.
4. Show result.
5. Disable local AI and use mock/cloud fallback.

---

## 31. UI design direction

Use a clean, practical field-tool aesthetic.

Design principles:

- Large touch targets
- Minimal forms per screen
- Card-based job list
- Clear sync badges
- Clear job status chips
- Prominent “Add note,” “Add photo,” and “Generate report”
- Low-friction capture
- Avoid decorative complexity

Suggested status colors:

- Draft
- Scheduled
- In progress
- Completed
- Archived

Suggested sync badges:

- Local only
- Pending sync
- Syncing
- Synced
- Failed
- Conflict

---

## 32. Example user flows

### 32.1 Create job manually

1. User taps “New Job.”
2. User enters title, client, site, and initial note.
3. App saves locally.
4. User lands on job detail.
5. Sync status shows pending/local.

### 32.2 Add voice/text note and extract fields

1. User opens job.
2. User adds rough note.
3. User taps “Extract details.”
4. AI provider returns structured suggestions.
5. User reviews suggestions.
6. User accepts selected fields.
7. App updates job/material/time tables.
8. AI result is stored.

### 32.3 Add proof photos

1. User taps “Add Photo.”
2. User chooses before/after/general.
3. User captures photo.
4. App saves local URI and metadata.
5. Photo appears immediately.
6. Upload happens later.

### 32.4 Generate report

1. User opens report tab.
2. App compiles job data.
3. App creates summary sections.
4. User reviews.
5. User shares/export.

---

## 33. Example report preview data mapping

```ts
type JobReportViewModel = {
  title: string;
  clientName?: string;
  siteAddress?: string;
  jobDate?: string;
  technicianName?: string;
  workPerformed: string[];
  materials: {
    name: string;
    quantity?: number;
    unit?: string;
  }[];
  laborMinutes?: number;
  photos: {
    type: "before" | "after" | "general" | "issue" | "material";
    uri: string;
    caption?: string;
  }[];
  customerApproval?: {
    approved: boolean;
    customerName?: string;
    approvedAt?: string;
  };
  followUpNotes: string[];
};
```

---

## 34. Example extraction schema

```ts
export const JobExtractionResultSchema = z.object({
  jobType: z.string().optional(),
  workPerformed: z.array(z.string()).default([]),
  issuesFound: z.array(z.string()).default([]),
  materials: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().optional(),
      unit: z.string().optional(),
      estimatedCost: z.number().optional()
    })
  ).default([]),
  durationMinutes: z.number().optional(),
  customerApproved: z.boolean().optional(),
  followUpNotes: z.array(z.string()).default([]),
  missingFields: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional()
});
```

---

## 35. Example prompt for cloud/local LLM extraction

Use this prompt only after the provider abstraction is ready.

```text
You are an information extraction engine for a field-service job documentation app.

Extract structured job information from the user's rough field note.

Rules:
- Return only valid JSON.
- Do not invent details.
- If a value is missing, omit it or add it to missingFields.
- Keep workPerformed as short action statements.
- Keep followUpNotes separate from completed work.
- Do not overwrite user intent.
- If unsure, use lower confidence.

Required JSON shape:
{
  "jobType": string | null,
  "workPerformed": string[],
  "issuesFound": string[],
  "materials": [
    {
      "name": string,
      "quantity": number | null,
      "unit": string | null,
      "estimatedCost": number | null
    }
  ],
  "durationMinutes": number | null,
  "customerApproved": boolean | null,
  "followUpNotes": string[],
  "missingFields": string[],
  "confidence": number
}

Field note:
{{input}}
```

---

## 36. Documentation files to create

The repo should include these docs.

### docs/PLAN.md

The implementation plan.

### docs/AGENT_HANDOFF.md

Operational instructions for AI coding agents.

### docs/ARCHITECTURE.md

Architecture overview with diagrams or structured text.

### docs/DATA_MODEL.md

Local and cloud schema documentation.

### docs/SYNC_STRATEGY.md

Detailed sync queue and conflict strategy.

### docs/AI_STRATEGY.md

AI provider architecture and phased local LLM plan.

### docs/MVP_SCOPE.md

Clear MVP inclusions and exclusions.

### docs/TESTING_STRATEGY.md

Test plan and quality gates.

### docs/DECISIONS/

Architecture decision records.

---

## 37. Risks and mitigations

### Risk: Local LLM is too heavy for mobile

Mitigation:

- Treat local LLM as an experiment.
- Build provider abstraction.
- Use mock/rule/cloud providers first.
- Keep local LLM task small.

### Risk: Offline sync becomes complex

Mitigation:

- Start with one-device assumption.
- Use explicit sync queue.
- Track versions.
- Avoid real-time multi-device editing in MVP.

### Risk: Media uploads fail or create duplicates

Mitigation:

- Store local photo first.
- Use stable photo IDs.
- Make upload idempotent.
- Record upload status.

### Risk: AI output corrupts records

Mitigation:

- Keep original notes.
- Store AI outputs separately.
- Require review before applying suggestions.
- Make edits reversible.

### Risk: Scope creep

Mitigation:

- Enforce MVP milestones.
- Do not add admin dashboard until mobile workflow works.
- Do not add local LLM until AI abstraction works.

---

## 38. Future features

After MVP:

- Multi-worker company accounts
- Admin dashboard
- Customer portal
- PDF branding
- Invoice integration
- QuickBooks integration
- OCR from receipts
- Offline speech-to-text
- Local LLM extraction
- Smart reminders
- Recurring jobs
- Asset/equipment tracking
- Templates by trade
- Safety checklist mode
- Inspection mode
- Route/day planner
- NFC/QR job tags
- Warranty tracking
- Analytics dashboard

---

## 39. Portfolio positioning

JobTrail should be presented as:

“An offline-first React Native field-service documentation app that helps workers capture job notes, photos, materials, labor time, and customer approvals in unreliable connectivity environments. It uses local persistence, sync queues, cloud backup, and AI-assisted structured extraction to turn rough field notes into professional job reports.”

Resume bullet examples:

- Built an offline-first React Native/Expo mobile app for field workers, using SQLite local persistence, sync queues, and cloud backup to preserve job records in poor-connectivity environments.
- Designed a local-first data model for jobs, notes, photos, materials, time entries, AI extraction results, and sync operations.
- Implemented an AI provider abstraction for mock, rule-based, cloud, and future on-device LLM extraction workflows.
- Developed a reviewable AI extraction flow that converts rough field notes into structured job details while preserving original user input.
- Built a professional job report generation flow from locally stored job data, photos, materials, and labor entries.

---

## 40. Immediate next steps

1. Create the GitHub repository.
2. Add this file to `docs/PLAN.md`.
3. Add `docs/AGENT_HANDOFF.md`.
4. Initialize Expo TypeScript app.
5. Build app shell and navigation.
6. Implement local SQLite schema and repositories.
7. Build manual job capture workflow.
8. Add AI provider abstraction.
9. Add rule-based extraction.
10. Add Firebase Auth and cloud sync only after the local workflow works.

---

## 41. Done definition for each agent pull request

Each PR should include:

- Clear summary of what changed
- Screenshots or short demo notes for UI changes
- Tests for domain/data logic where practical
- Updated docs if architecture changed
- No committed secrets
- No unrelated large rewrites
- No broken TypeScript build
- No placeholder feature described as complete

---

## 42. Agent operating rule

The agent should always prioritize a working vertical slice over broad incomplete scaffolding.

The preferred first vertical slice is:

Create job locally -> add rough note -> run mock extraction -> accept material/time suggestions -> view report preview -> restart app and confirm persistence.

Everything else should build around that slice.
