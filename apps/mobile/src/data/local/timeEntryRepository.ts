import { v4 as uuidv4 } from 'uuid';
import type { TimeEntry } from '../../domain/types';
import type { AppDatabase } from './types';
import { createSyncOperation } from './syncRepository';

const DEFAULT_USER_ID = 'local_user';

function now(): string {
  return new Date().toISOString();
}

export async function createTimeEntry(
  db: AppDatabase,
  jobId: string,
  input: { durationMinutes: number; description?: string; startedAt?: string; endedAt?: string }
): Promise<TimeEntry> {
  const id = uuidv4();
  const timestamp = now();

  const entry: TimeEntry = {
    id,
    jobId,
    userId: DEFAULT_USER_ID,
    startedAt: input.startedAt ?? null,
    endedAt: input.endedAt ?? null,
    durationMinutes: input.durationMinutes,
    description: input.description ?? null,
    billable: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    syncStatus: 'local_only',
  };

  await db.runAsync(
    `INSERT INTO time_entries (id, jobId, userId, startedAt, endedAt, durationMinutes, description, billable, createdAt, updatedAt, syncStatus)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.id, entry.jobId, entry.userId, entry.startedAt, entry.endedAt,
      entry.durationMinutes, entry.description, entry.billable ? 1 : 0,
      entry.createdAt, entry.updatedAt, entry.syncStatus,
    ]
  );

  // Create sync operation
  await createSyncOperation(db, {
    entityType: 'timeEntry',
    entityId: entry.id,
    operationType: 'create',
    payloadJson: JSON.stringify(entry),
    status: 'pending',
  }).catch(() => {}); // Non-critical — don't fail the main operation

  return entry;
}

export async function getTimeEntriesByJobId(db: AppDatabase, jobId: string): Promise<TimeEntry[]> {
  return db.getAllAsync<TimeEntry>(
    'SELECT * FROM time_entries WHERE jobId = ? AND deletedAt IS NULL ORDER BY createdAt ASC',
    [jobId]
  );
}

export async function deleteTimeEntry(db: AppDatabase, id: string): Promise<boolean> {
  const timestamp = now();
  const result = await db.runAsync(
    'UPDATE time_entries SET deletedAt = ?, updatedAt = ? WHERE id = ?',
    [timestamp, timestamp, id]
  );

  // Create sync operation for the delete
  if (result.changes > 0) {
    await createSyncOperation(db, {
      entityType: 'timeEntry',
      entityId: id,
      operationType: 'delete',
      payloadJson: JSON.stringify({ id, deletedAt: timestamp }),
      status: 'pending',
    }).catch(() => {}); // Non-critical — don't fail the main operation
  }

  return result.changes > 0;
}