# JobTrail Mobile App

Offline-first field work documentation app built with React Native, Expo, and SQLite.

## Tech Stack

- React Native / Expo SDK 54
- TypeScript
- Expo Router (file-based navigation)
- Expo SQLite (local persistence)
- Zod (validation schemas)

## Getting Started

```bash
# Install dependencies
npm install

# Start the development server
npx expo start
```

Open in Expo Go on your device or run on an emulator.

## Project Structure

```
app/                    # Expo Router screens
  _layout.tsx           # Root layout with SQLiteProvider
  index.tsx             # Job list (home screen)
  job/
    create.tsx          # Create new job
    [id].tsx            # Job detail
    [id]/
      note.tsx          # Add note to job
      material.tsx      # Add material to job
      time.tsx          # Add time entry to job
      extract.tsx       # AI extraction review
      report.tsx        # Report preview

src/
  domain/
    types.ts            # Domain type definitions
    schemas.ts          # Zod validation schemas
  data/local/
    migrations.ts       # SQLite schema migrations
    jobRepository.ts    # Job CRUD operations
    noteRepository.ts   # Note CRUD operations
    materialRepository.ts # Material CRUD operations
    timeEntryRepository.ts # Time entry CRUD operations
    extractionRepository.ts # AI extraction result CRUD
  ai/
    AiProvider.ts       # AI provider interface
    MockAiProvider.ts   # Mock provider for testing
    RuleBasedAiProvider.ts # Rule-based extraction
  theme/
    colors.ts           # Theme constants
```

## Milestone A Features

- Create jobs locally
- Add notes, materials, and time entries
- Rule-based AI extraction from notes
- Review and accept/reject AI suggestions
- Report preview
- Data persists across app restarts

## Testing

See acceptance test steps in `docs/AGENT_HANDOFF.md`.