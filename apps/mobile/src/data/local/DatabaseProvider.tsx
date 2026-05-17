import React, { createContext, useContext, useEffect, useState } from 'react';
import { Platform, View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { migrateDbIfNeeded } from './migrations';
import { MockSQLiteDatabase } from './MockDatabase';
import type { AppDatabase } from './types';
import { Colors } from '../../theme/colors';

const DatabaseContext = createContext<AppDatabase | null>(null);

export function useDatabase(): AppDatabase {
  const db = useContext(DatabaseContext);
  if (!db) {
    throw new Error('useDatabase must be used within a DatabaseProvider');
  }
  return db;
}

// Initialize mock database with schema
async function initMockDb(): Promise<MockSQLiteDatabase> {
  const db = new MockSQLiteDatabase();
  await db.execAsync(`
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
      syncStatus TEXT NOT NULL DEFAULT 'local_only'
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
      syncStatus TEXT NOT NULL DEFAULT 'local_only'
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
      syncStatus TEXT NOT NULL DEFAULT 'local_only'
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
      rejectedAt TEXT
    );
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
      syncStatus TEXT NOT NULL DEFAULT 'local_only'
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
      syncStatus TEXT NOT NULL DEFAULT 'local_only'
    );
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
  return db;
}

// Bridge component that gets the real SQLite db and provides it through context
function NativeDbBridge({ children }: { children: React.ReactNode }) {
  const db = useSQLiteContext();
  return (
    <DatabaseContext.Provider value={db}>
      {children}
    </DatabaseContext.Provider>
  );
}

export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [mockDb, setMockDb] = useState<MockSQLiteDatabase | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') {
      initMockDb().then((db) => {
        setMockDb(db);
        setReady(true);
      });
    } else {
      setReady(true);
    }
  }, []);

  if (!ready) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (Platform.OS === 'web') {
    return (
      <DatabaseContext.Provider value={mockDb!}>
        {children}
      </DatabaseContext.Provider>
    );
  }

  // Native: use real SQLite
  return (
    <SQLiteProvider databaseName="jobtrail.db" onInit={migrateDbIfNeeded}>
      <NativeDbBridge>{children}</NativeDbBridge>
    </SQLiteProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: Colors.textSecondary,
  },
});