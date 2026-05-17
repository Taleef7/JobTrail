# Milestone B: Photos, Auth, and Cloud Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Firebase Auth, Firestore sync, photo capture with local persistence, and sync status badges to JobTrail.

**Architecture:** Firebase JS SDK (works in Expo Go, no prebuild required) for Auth + Firestore. expo-image-picker for photo capture. Local SQLite remains source of truth; Firestore is the sync target. Each local mutation creates a sync_operation; a background sync engine pushes pending changes when online.

**Tech Stack:** Firebase JS SDK v12, @react-native-async-storage/async-storage, expo-image-picker, expo-file-system, expo-sqlite (existing)

---

## File Structure

### New files to create:
- `src/data/remote/firebaseConfig.ts` — Firebase initialization
- `src/data/remote/authService.ts` — Auth operations (sign up, sign in, sign out, current user)
- `src/data/remote/firestoreSync.ts` — Firestore CRUD + sync engine
- `src/data/remote/storageService.ts` — Firebase Storage upload for photos
- `src/data/local/syncRepository.ts` — sync_operations table CRUD
- `src/data/local/photoRepository.ts` — photo_assets table CRUD
- `src/data/local/userRepository.ts` — users table CRUD
- `src/hooks/useAuth.ts` — Auth state hook
- `src/hooks/useSyncStatus.ts` — Sync status hook
- `src/context/AuthContext.tsx` — Auth provider + context
- `src/context/SyncContext.tsx` — Sync provider + context
- `app/auth/login.tsx` — Login screen
- `app/auth/signup.tsx` — Sign up screen
- `app/job/[id]/photo.tsx` — Add photo screen
- `app/(auth)/_layout.tsx` — Auth stack layout
- `app/(main)/_layout.tsx` — Main app layout (post-auth)
- `.env.example` — Firebase config template

### Files to modify:
- `src/data/local/migrations.ts` — Add photo_assets, users, sync_operations tables
- `src/data/local/MockDatabase.ts` — Add new table support
- `src/data/local/DatabaseProvider.tsx` — Add new table init for mock DB
- `src/domain/types.ts` — Add PhotoAsset, User, SyncOperation types
- `src/domain/schemas.ts` — Add Zod schemas for new types
- `app/_layout.tsx` — Wrap with AuthProvider + SyncProvider
- `app/job/[id].tsx` — Add photo section + sync status badge
- `app/job/[id]/report.tsx` — Include photos in report
- `package.json` — Add firebase, async-storage, image-picker, file-system deps

---

## Task 1: Install Dependencies and Configure Firebase

**Files:**
- Modify: `package.json`
- Create: `.env.example`
- Create: `src/data/remote/firebaseConfig.ts`

- [ ] **Step 1: Install npm packages**

```bash
cd apps/mobile
npm install firebase @react-native-async-storage/async-storage expo-image-picker expo-file-system
```

- [ ] **Step 2: Create `.env.example`**

```env
EXPO_PUBLIC_FIREBASE_API_KEY=
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=
EXPO_PUBLIC_FIREBASE_PROJECT_ID=
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
EXPO_PUBLIC_FIREBASE_APP_ID=
```

- [ ] **Step 3: Create `src/data/remote/firebaseConfig.ts`**

```typescript
import { initializeApp } from 'firebase/app';
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

export const db = getFirestore(app);

// Enable offline persistence for Firestore
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === 'failed-precondition') {
    console.warn('Firestore persistence: multiple tabs open');
  } else if (err.code === 'unimplemented') {
    console.warn('Firestore persistence: not supported in this browser');
  }
});

export const storage = getStorage(app);
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS (may have warnings about missing env vars, but no type errors)

- [ ] **Step 5: Commit**

```bash
git add package.json .env.example src/data/remote/firebaseConfig.ts
git commit -m "feat: install Firebase deps and add config"
```

---

## Task 2: Add Domain Types and Zod Schemas for New Entities

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/domain/schemas.ts`

- [ ] **Step 1: Add new types to `src/domain/types.ts`**

Add these types after the existing ones:

```typescript
// User profile (local mirror of Firebase Auth user)
export type User = {
  id: string; // local UUID
  cloudUid: string; // Firebase Auth UID
  email: string;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string | null;
};

// Photo asset attached to a job
export type PhotoAsset = {
  id: string;
  jobId: string;
  userId: string;
  localUri: string;
  remoteUrl: string | null;
  photoType: 'before' | 'after' | 'general' | 'issue' | 'material';
  caption: string | null;
  takenAt: string | null;
  uploadStatus: 'pending' | 'uploading' | 'uploaded' | 'failed';
  syncStatus: 'local_only' | 'pending' | 'syncing' | 'synced' | 'failed';
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

// Sync operation queue entry
export type SyncOperation = {
  id: string;
  entityType: string;
  entityId: string;
  operationType: 'create' | 'update' | 'delete';
  payloadJson: string;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  retryCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
};
```

- [ ] **Step 2: Add Zod schemas to `src/domain/schemas.ts`**

```typescript
export const UserSchema = z.object({
  id: z.string().uuid(),
  cloudUid: z.string(),
  email: z.string().email(),
  displayName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastSyncedAt: z.string().nullable(),
});

export const PhotoAssetSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  userId: z.string(),
  localUri: z.string(),
  remoteUrl: z.string().nullable(),
  photoType: z.enum(['before', 'after', 'general', 'issue', 'material']),
  caption: z.string().nullable(),
  takenAt: z.string().nullable(),
  uploadStatus: z.enum(['pending', 'uploading', 'uploaded', 'failed']),
  syncStatus: z.enum(['local_only', 'pending', 'syncing', 'synced', 'failed']),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});

export const SyncOperationSchema = z.object({
  id: z.string().uuid(),
  entityType: z.string(),
  entityId: z.string(),
  operationType: z.enum(['create', 'update', 'delete']),
  payloadJson: z.string(),
  status: z.enum(['pending', 'syncing', 'synced', 'failed']),
  retryCount: z.number().int().default(0),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  processedAt: z.string().nullable(),
});
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/domain/types.ts src/domain/schemas.ts
git commit -m "feat: add User, PhotoAsset, SyncOperation types and schemas"
```

---

## Task 3: Add Database Migrations for New Tables

**Files:**
- Modify: `src/data/local/migrations.ts`
- Modify: `src/data/local/MockDatabase.ts`
- Modify: `src/data/local/DatabaseProvider.tsx`

- [ ] **Step 1: Add migration for new tables in `migrations.ts`**

Bump `DATABASE_VERSION` to 2 and add the v2 migration:

```typescript
const DATABASE_VERSION = 2;

// In the migrateDbIfNeeded function, add after the v0 block:
if (currentVersion < 2) {
  await db.execAsync(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      cloudUid TEXT NOT NULL,
      email TEXT NOT NULL,
      displayName TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      lastSyncedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS photo_assets (
      id TEXT PRIMARY KEY,
      jobId TEXT NOT NULL,
      userId TEXT NOT NULL,
      localUri TEXT NOT NULL,
      remoteUrl TEXT,
      photoType TEXT NOT NULL DEFAULT 'general',
      caption TEXT,
      takenAt TEXT,
      uploadStatus TEXT NOT NULL DEFAULT 'pending',
      syncStatus TEXT NOT NULL DEFAULT 'local_only',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT,
      FOREIGN KEY (jobId) REFERENCES jobs(id)
    );

    CREATE TABLE IF NOT EXISTS sync_operations (
      id TEXT PRIMARY KEY,
      entityType TEXT NOT NULL,
      entityId TEXT NOT NULL,
      operationType TEXT NOT NULL,
      payloadJson TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      retryCount INTEGER NOT NULL DEFAULT 0,
      lastError TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      processedAt TEXT
    );
  `);
}
```

- [ ] **Step 2: Add new table creation to MockDatabase init in `DatabaseProvider.tsx`**

Add these CREATE TABLE statements to the `initMockDb` function's `execAsync` call:

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  cloudUid TEXT NOT NULL,
  email TEXT NOT NULL,
  displayName TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  lastSyncedAt TEXT
);

CREATE TABLE IF NOT EXISTS photo_assets (
  id TEXT PRIMARY KEY,
  jobId TEXT NOT NULL,
  userId TEXT NOT NULL,
  localUri TEXT NOT NULL,
  remoteUrl TEXT,
  photoType TEXT NOT NULL DEFAULT 'general',
  caption TEXT,
  takenAt TEXT,
  uploadStatus TEXT NOT NULL DEFAULT 'pending',
  syncStatus TEXT NOT NULL DEFAULT 'local_only',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT
);

CREATE TABLE IF NOT EXISTS sync_operations (
  id TEXT PRIMARY KEY,
  entityType TEXT NOT NULL,
  entityId TEXT NOT NULL,
  operationType TEXT NOT NULL,
  payloadJson TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retryCount INTEGER NOT NULL DEFAULT 0,
  lastError TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  processedAt TEXT
);
```

- [ ] **Step 3: Add INSERT/SELECT/UPDATE/DELETE support for new tables in MockDatabase.ts**

Add handling for `photo_assets`, `users`, and `sync_operations` in the `execStatement` method's CREATE TABLE parser and the `executeSelect` method. Follow the existing pattern for other tables (the mock DB already handles camelCase column names generically).

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/data/local/migrations.ts src/data/local/MockDatabase.ts src/data/local/DatabaseProvider.tsx
git commit -m "feat: add users, photo_assets, sync_operations tables"
```

---

## Task 4: Add Repositories for New Entities

**Files:**
- Create: `src/data/local/userRepository.ts`
- Create: `src/data/local/photoRepository.ts`
- Create: `src/data/local/syncRepository.ts`

- [ ] **Step 1: Create `src/data/local/userRepository.ts`**

```typescript
import type { AppDatabase } from './types';
import { v4 as uuidv4 } from 'uuid';
import type { User } from '../../domain/types';

export async function createUser(db: AppDatabase, user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
  const now = new Date().toISOString();
  const record: User = {
    id: uuidv4(),
    createdAt: now,
    updatedAt: now,
    ...user,
  };
  await db.runAsync(
    `INSERT INTO users (id, cloudUid, email, displayName, createdAt, updatedAt, lastSyncedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    record.id, record.cloudUid, record.email, record.displayName, record.createdAt, record.updatedAt, record.lastSyncedAt
  );
  return record;
}

export async function getUserByCloudUid(db: AppDatabase, cloudUid: string): Promise<User | null> {
  return db.getFirstAsync<User>(
    `SELECT * FROM users WHERE cloudUid = ?`,
    cloudUid
  );
}

export async function updateUser(db: AppDatabase, id: string, updates: Partial<User>): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (key === 'id' || key === 'createdAt') continue;
    fields.push(`${key} = ?`);
    values.push(value);
  }
  if (fields.length === 0) return;
  values.push(new Date().toISOString(), id);
  await db.runAsync(
    `UPDATE users SET ${fields.join(', ')}, updatedAt = ? WHERE id = ?`,
    ...values
  );
}
```

- [ ] **Step 2: Create `src/data/local/photoRepository.ts`**

```typescript
import type { AppDatabase } from './types';
import { v4 as uuidv4 } from 'uuid';
import type { PhotoAsset } from '../../domain/types';

export async function createPhoto(db: AppDatabase, jobId: string, photo: Omit<PhotoAsset, 'id' | 'jobId' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<PhotoAsset> {
  const now = new Date().toISOString();
  const record: PhotoAsset = {
    id: uuidv4(),
    jobId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...photo,
  };
  await db.runAsync(
    `INSERT INTO photo_assets (id, jobId, userId, localUri, remoteUrl, photoType, caption, takenAt, uploadStatus, syncStatus, createdAt, updatedAt, deletedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    record.id, record.jobId, record.userId, record.localUri, record.remoteUrl, record.photoType, record.caption, record.takenAt, record.uploadStatus, record.syncStatus, record.createdAt, record.updatedAt, record.deletedAt
  );
  return record;
}

export async function getPhotosByJobId(db: AppDatabase, jobId: string): Promise<PhotoAsset[]> {
  return db.getAllAsync<PhotoAsset>(
    `SELECT * FROM photo_assets WHERE jobId = ? AND deletedAt IS NULL ORDER BY createdAt ASC`,
    jobId
  );
}

export async function updatePhoto(db: AppDatabase, id: string, updates: Partial<PhotoAsset>): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (key === 'id' || key === 'createdAt') continue;
    fields.push(`${key} = ?`);
    values.push(value);
  }
  if (fields.length === 0) return;
  values.push(new Date().toISOString(), id);
  await db.runAsync(
    `UPDATE photo_assets SET ${fields.join(', ')}, updatedAt = ? WHERE id = ?`,
    ...values
  );
}

export async function deletePhoto(db: AppDatabase, id: string): Promise<void> {
  await db.runAsync(
    `UPDATE photo_assets SET deletedAt = ?, updatedAt = ? WHERE id = ?`,
    new Date().toISOString(), new Date().toISOString(), id
  );
}
```

- [ ] **Step 3: Create `src/data/local/syncRepository.ts`**

```typescript
import type { AppDatabase } from './types';
import { v4 as uuidv4 } from 'uuid';
import type { SyncOperation } from '../../domain/types';

export async function createSyncOperation(db: AppDatabase, op: Omit<SyncOperation, 'id' | 'createdAt' | 'updatedAt' | 'retryCount' | 'lastError' | 'processedAt'>): Promise<SyncOperation> {
  const now = new Date().toISOString();
  const record: SyncOperation = {
    id: uuidv4(),
    retryCount: 0,
    lastError: null,
    processedAt: null,
    createdAt: now,
    updatedAt: now,
    ...op,
  };
  await db.runAsync(
    `INSERT INTO sync_operations (id, entityType, entityId, operationType, payloadJson, status, retryCount, lastError, createdAt, updatedAt, processedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    record.id, record.entityType, record.entityId, record.operationType, record.payloadJson, record.status, record.retryCount, record.lastError, record.createdAt, record.updatedAt, record.processedAt
  );
  return record;
}

export async function getPendingSyncOperations(db: AppDatabase): Promise<SyncOperation[]> {
  return db.getAllAsync<SyncOperation>(
    `SELECT * FROM sync_operations WHERE status = 'pending' ORDER BY createdAt ASC`
  );
}

export async function updateSyncOperation(db: AppDatabase, id: string, updates: Partial<SyncOperation>): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (key === 'id' || key === 'createdAt') continue;
    fields.push(`${key} = ?`);
    values.push(value);
  }
  if (fields.length === 0) return;
  values.push(new Date().toISOString(), id);
  await db.runAsync(
    `UPDATE sync_operations SET ${fields.join(', ')}, updatedAt = ? WHERE id = ?`,
    ...values
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/data/local/userRepository.ts src/data/local/photoRepository.ts src/data/local/syncRepository.ts
git commit -m "feat: add user, photo, and sync repositories"
```

---

## Task 5: Add Auth Context and Screens

**Files:**
- Create: `src/context/AuthContext.tsx`
- Create: `app/auth/login.tsx`
- Create: `app/auth/signup.tsx`
- Modify: `app/_layout.tsx`

- [ ] **Step 1: Create `src/context/AuthContext.tsx`**

This provides `user`, `loading`, `signIn`, `signUp`, `signOut` and auto-creates a local User record on first sign-in.

```typescript
import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut as firebaseSignOut, type User as FirebaseUser } from 'firebase/auth';
import { auth } from '../data/remote/firebaseConfig';
import { useDatabase } from '../data/local/DatabaseProvider';
import { createUser, getUserByCloudUid, updateUser } from '../data/local/userRepository';

type AuthContextType = {
  user: FirebaseUser | null;
  localUserId: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [localUserId, setLocalUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const db = useDatabase();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        // Ensure local user record exists
        let localUser = await getUserByCloudUid(db, firebaseUser.uid);
        if (!localUser) {
          localUser = await createUser(db, {
            cloudUid: firebaseUser.uid,
            email: firebaseUser.email ?? '',
            displayName: firebaseUser.displayName,
            lastSyncedAt: null,
          });
        }
        setLocalUserId(localUser.id);
      } else {
        setLocalUserId(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, [db]);

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signUp = async (email: string, password: string, displayName?: string) => {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName && credential.user.updateProfile) {
      await credential.user.updateProfile({ displayName });
    }
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setLocalUserId(null);
  };

  return (
    <AuthContext.Provider value={{ user, localUserId, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
```

- [ ] **Step 2: Create `app/auth/login.tsx`**

A login screen with email/password fields, sign-in button, and link to sign-up.

- [ ] **Step 3: Create `app/auth/signup.tsx`**

A sign-up screen with email, password, and optional display name.

- [ ] **Step 4: Modify `app/_layout.tsx`**

Wrap the app with `AuthProvider`. Show a loading spinner while auth state resolves. If no user, redirect to `/auth/login`. If user exists, show the main app.

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/context/AuthContext.tsx app/auth/login.tsx app/auth/signup.tsx app/_layout.tsx
git commit -m "feat: add Firebase Auth with login/signup screens"
```

---

## Task 6: Add Photo Capture Screen

**Files:**
- Create: `app/job/[id]/photo.tsx`
- Modify: `app/job/[id].tsx` — Add photo section + "Add Photo" button

- [ ] **Step 1: Create `app/job/[id]/photo.tsx`**

Photo capture screen using expo-image-picker. Allows selecting photo type (before/after/general/issue/material), adding a caption, and saving to local DB with `uploadStatus: 'pending'`.

- [ ] **Step 2: Add photo section to `app/job/[id].tsx`**

Add a "Photos" section between Materials and Time sections. Show photo thumbnails with type badges. Add "+ Add" button that navigates to `/job/[id]/photo`.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add app/job/[id]/photo.tsx app/job/[id].tsx
git commit -m "feat: add photo capture screen and photo section in job detail"
```

---

## Task 7: Add Firestore Sync Engine

**Files:**
- Create: `src/data/remote/firestoreSync.ts`
- Create: `src/context/SyncContext.tsx`
- Modify: `app/_layout.tsx` — Wrap with SyncProvider

- [ ] **Step 1: Create `src/data/remote/firestoreSync.ts`**

This module provides functions to:
- `syncJobToCloud(localJob, userId)` — Push a local job to Firestore
- `syncNoteToCloud(localNote, userId)` — Push a note
- `syncMaterialToCloud(localMaterial, userId)` — Push a material
- `syncTimeEntryToCloud(localTimeEntry, userId)` — Push a time entry
- `syncPhotoToCloud(localPhoto, userId)` — Push photo metadata (not the file)
- `processSyncQueue(db, userId)` — Process all pending sync_operations

Each sync function:
1. Reads the pending SyncOperation from SQLite
2. Converts local data to Firestore format
3. Writes to Firestore under `users/{uid}/jobs/{jobId}` etc.
4. On success, updates the local record's `syncStatus` to `'synced'` and marks the SyncOperation as `'synced'`
5. On failure, increments `retryCount` and sets `lastError`

- [ ] **Step 2: Create `src/context/SyncContext.tsx`**

Provides `syncStatus` (counts of pending/synced/failed operations) and a `triggerSync()` function. Uses `NetInfo` from `@react-native-community/netinfo` to detect connectivity. Auto-syncs when online.

- [ ] **Step 3: Modify `app/_layout.tsx`**

Wrap with `SyncProvider` inside `AuthProvider`.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/data/remote/firestoreSync.ts src/context/SyncContext.tsx app/_layout.tsx
git commit -m "feat: add Firestore sync engine and SyncContext"
```

---

## Task 8: Add Sync Status Badges and Photo Upload

**Files:**
- Modify: `app/index.tsx` — Add sync badge to job cards
- Modify: `app/job/[id].tsx` — Add sync status indicator
- Create: `src/data/remote/storageService.ts` — Firebase Storage upload
- Modify: `src/context/SyncContext.tsx` — Add photo upload to sync process

- [ ] **Step 1: Create `src/data/remote/storageService.ts`**

Upload photo to Firebase Storage under `users/{uid}/jobs/{jobId}/photos/{photoId}.jpg`. Update local `remoteUrl` and `uploadStatus` after successful upload.

- [ ] **Step 2: Add sync status badges to job list cards**

Show a small colored dot on each job card: green = synced, yellow = pending, red = failed.

- [ ] **Step 3: Add sync status indicator to job detail**

Show a "Sync: synced/pending/failed" line in the job detail header.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/data/remote/storageService.ts app/index.tsx app/job/[id].tsx src/context/SyncContext.tsx
git commit -m "feat: add sync status badges and photo upload to storage"
```

---

## Task 9: Update Report to Include Photos

**Files:**
- Modify: `app/job/[id]/report.tsx` — Add photos section

- [ ] **Step 1: Add photos section to report**

Load photos via `getPhotosByJobId`. Display photo thumbnails with type labels (before/after/general/issue/material) and captions.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add app/job/[id]/report.tsx
git commit -m "feat: add photos to report preview"
```

---

## Task 10: Wire Sync Operations into Existing Repositories

**Files:**
- Modify: `src/data/local/jobRepository.ts` — Create sync_operation on create/update
- Modify: `src/data/local/noteRepository.ts` — Create sync_operation on create
- Modify: `src/data/local/materialRepository.ts` — Create sync_operation on create
- Modify: `src/data/local/timeEntryRepository.ts` — Create sync_operation on create

- [ ] **Step 1: Add `createSyncOperation` calls to each repository**

After each local create/update, also create a `sync_operations` entry with `status: 'pending'`. This ensures the sync engine can pick up changes.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/data/local/jobRepository.ts src/data/local/noteRepository.ts src/data/local/materialRepository.ts src/data/local/timeEntryRepository.ts
git commit -m "feat: wire sync operations into all repositories"
```

---

## Task 11: End-to-End Testing and Documentation

**Files:**
- Modify: `docs/AGENT_HANDOFF.md` — Update with Milestone B status

- [ ] **Step 1: Test the full auth flow**

1. Start the app — should redirect to login screen
2. Sign up with email/password
3. Verify local user record created
4. Sign out
5. Sign back in
6. Verify user persists

- [ ] **Step 2: Test photo capture flow**

1. Create a job
2. Add a photo (select from library)
3. Verify photo appears in job detail
4. Verify photo appears in report preview

- [ ] **Step 3: Test sync flow**

1. Create a job offline (airplane mode)
2. Verify sync status shows "pending"
3. Come back online
4. Verify sync status changes to "synced"
5. Check Firestore console for the job document

- [ ] **Step 4: Update `docs/AGENT_HANDOFF.md`**

Add Milestone B status section with:
- What was implemented
- How to configure Firebase
- How to test
- Known limitations

- [ ] **Step 5: Commit**

```bash
git add docs/AGENT_HANDOFF.md
git commit -m "docs: update handoff with Milestone B status"
```

---

## Acceptance Demo

1. Login with email/password
2. Create a job offline
3. Add photos offline
4. Reconnect
5. Sync job and photos
6. Confirm cloud records exist in Firestore console
7. Open app again and see synced status