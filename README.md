# JobTrail

Offline-first mobile field-work assistant for contractors, repair technicians, cleaners, inspectors, and field service workers.

Turn field notes, photos, time, materials, and customer sign-off into clean job records and report-ready summaries — even without internet.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React Native + Expo SDK 54 |
| Language | TypeScript (strict) |
| Navigation | Expo Router (file-based) |
| Local Database | SQLite (expo-sqlite) |
| Validation | Zod |
| Authentication | Firebase Auth (email/password + Google) |
| Cloud Sync | Firestore + Firebase Storage |
| AI | Rule-based extraction (extensible provider interface) |

## Project Structure

```
jobtrail/
├── apps/
│   └── mobile/          # React Native / Expo app
│       ├── app/         # Expo Router screens
│       ├── src/
│       │   ├── ai/      # AI provider abstraction
│       │   ├── context/ # React contexts (auth, sync)
│       │   ├── data/
│       │   │   ├── local/   # SQLite migrations & repositories
│       │   │   └── remote/  # Firebase config & sync engine
│       │   ├── domain/  # Types & Zod schemas
│       │   ├── theme/   # Design tokens
│       │   └── utils/   # Shared utilities
│       ├── firestore.rules
│       └── storage.rules
├── docs/                # Planning & handoff docs
└── .github/workflows/   # CI pipeline
```

## Getting Started

### Prerequisites

- Node.js 22+
- npm
- Expo CLI (`npm install -g expo-cli`)
- A Firebase project (see setup below)

### Install & Run

```bash
cd apps/mobile
npm install
npx expo start
```

Scan the QR code with Expo Go (iOS/Android), or press:

- `a` for Android emulator
- `i` for iOS simulator
- `w` for web browser (limited — uses in-memory mock database)

### Firebase Setup

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Authentication** → **Email/Password** and **Google** sign-in
3. Create a **Cloud Firestore** database (native mode)
4. Set up **Cloud Storage** (default bucket)
5. Copy `apps/mobile/.env.example` to `apps/mobile/.env` and fill in your config:

```env
EXPO_PUBLIC_FIREBASE_API_KEY=your-api-key
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
EXPO_PUBLIC_FIREBASE_APP_ID=your-app-id
```

6. Deploy security rules: `firebase deploy --only firestore:rules,storage`

## Features

### Milestone A — Local Job Capture ✅
- Create jobs with title, type, notes
- Add notes, materials, time entries
- Rule-based AI extraction from rough notes
- Review and accept extracted fields
- Report preview with all job data
- Local SQLite persistence

### Milestone B — Photos, Auth & Sync ✅
- Firebase Auth with email/password and Google sign-in
- Photo capture with type tagging (before/after/general/issue/material)
- Auto-sync to Firestore (30s interval)
- Sync status badges on job list and detail
- Firestore + Storage security rules
- Photo gallery in reports

## Scripts

```bash
npm run start       # Start Expo dev server
npm run web         # Start web version
npm run lint        # Run ESLint
npm run typecheck   # Run TypeScript type check
```

## CI/CD

GitHub Actions runs on every push/PR:

- **TypeScript** — strict type checking
- **ESLint** — code quality with Expo config
- **Expo Export** — verifies web build

## Architecture Principles

- **Offline-first**: Local SQLite is the source of truth. Cloud sync is additive.
- **AI-assisted, not AI-dependent**: Users can complete all workflows manually.
- **Review before apply**: AI suggestions are never written without user review.
- **Provider abstraction**: AI and sync engines are swappable behind interfaces.

## License

MIT
