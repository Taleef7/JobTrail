import { type SQLiteDatabase } from 'expo-sqlite';

const DATABASE_VERSION = 5;

export async function migrateDbIfNeeded(db: SQLiteDatabase): Promise<void> {
  const result = await db.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version'
  );
  const currentVersion = result?.user_version ?? 0;

  if (currentVersion >= DATABASE_VERSION) return;

  if (currentVersion === 0) {
    await db.execAsync(`
      PRAGMA journal_mode = 'wal';
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        title TEXT NOT NULL,
        jobType TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        priority TEXT DEFAULT 'normal',
        roughNotes TEXT,
        structuredSummary TEXT,
        internalNotes TEXT,
        customerVisibleSummary TEXT,
        aiStatus TEXT DEFAULT 'not_started',
        syncStatus TEXT NOT NULL DEFAULT 'local_only',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        deletedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS job_notes (
        id TEXT PRIMARY KEY,
        jobId TEXT NOT NULL,
        userId TEXT NOT NULL,
        noteType TEXT NOT NULL DEFAULT 'manual',
        content TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        deletedAt TEXT,
        syncStatus TEXT NOT NULL DEFAULT 'local_only',
        FOREIGN KEY (jobId) REFERENCES jobs(id)
      );

      CREATE TABLE IF NOT EXISTS material_line_items (
        id TEXT PRIMARY KEY,
        jobId TEXT NOT NULL,
        userId TEXT NOT NULL,
        name TEXT NOT NULL,
        quantity REAL DEFAULT 1,
        unit TEXT,
        unitCost REAL,
        totalCost REAL,
        billable INTEGER DEFAULT 1,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        deletedAt TEXT,
        syncStatus TEXT NOT NULL DEFAULT 'local_only',
        FOREIGN KEY (jobId) REFERENCES jobs(id)
      );

      CREATE TABLE IF NOT EXISTS time_entries (
        id TEXT PRIMARY KEY,
        jobId TEXT NOT NULL,
        userId TEXT NOT NULL,
        startedAt TEXT,
        endedAt TEXT,
        durationMinutes INTEGER,
        description TEXT,
        billable INTEGER DEFAULT 1,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        deletedAt TEXT,
        syncStatus TEXT NOT NULL DEFAULT 'local_only',
        FOREIGN KEY (jobId) REFERENCES jobs(id)
      );

      CREATE TABLE IF NOT EXISTS ai_extraction_results (
        id TEXT PRIMARY KEY,
        jobId TEXT NOT NULL,
        userId TEXT NOT NULL,
        sourceType TEXT NOT NULL,
        sourceId TEXT,
        provider TEXT NOT NULL,
        modelName TEXT,
        inputText TEXT NOT NULL,
        extractedJson TEXT NOT NULL,
        confidence REAL,
        createdAt TEXT NOT NULL,
        acceptedAt TEXT,
        rejectedAt TEXT,
        FOREIGN KEY (jobId) REFERENCES jobs(id)
      );
    `);
  }

  if (currentVersion < 2) {
    await db.execAsync(`
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

  if (currentVersion < 3) {
    await db.execAsync(`
      ALTER TABLE jobs ADD COLUMN clientId TEXT;
      ALTER TABLE jobs ADD COLUMN siteId TEXT;

      CREATE TABLE IF NOT EXISTS clients (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        notes TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        deletedAt TEXT,
        syncStatus TEXT NOT NULL DEFAULT 'local_only',
        FOREIGN KEY (userId) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS sites (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        clientId TEXT,
        name TEXT,
        addressLine1 TEXT,
        addressLine2 TEXT,
        city TEXT,
        state TEXT,
        postalCode TEXT,
        country TEXT,
        notes TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        deletedAt TEXT,
        syncStatus TEXT NOT NULL DEFAULT 'local_only',
        FOREIGN KEY (userId) REFERENCES users(id),
        FOREIGN KEY (clientId) REFERENCES clients(id)
      );
    `);
  }

  if (currentVersion < 4) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS customer_approvals (
        id TEXT PRIMARY KEY,
        jobId TEXT NOT NULL,
        userId TEXT NOT NULL,
        customerName TEXT,
        signatureLocalUri TEXT,
        signatureRemoteUrl TEXT,
        approvedAt TEXT,
        approvalNotes TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        deletedAt TEXT,
        syncStatus TEXT NOT NULL DEFAULT 'local_only'
      );
    `);
  }

  if (currentVersion < 5) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS voice_notes (
        id TEXT PRIMARY KEY,
        jobId TEXT NOT NULL,
        userId TEXT NOT NULL,
        localAudioUri TEXT,
        durationSeconds INTEGER,
        transcript TEXT,
        transcriptSource TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        deletedAt TEXT,
        syncStatus TEXT NOT NULL DEFAULT 'local_only'
      );
    `);
  }

  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}