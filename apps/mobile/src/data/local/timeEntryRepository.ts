import { v4 as uuidv4 } from 'uuid';
import type { TimeEntry } from '../../domain/types';
import type { AppDatabase } from './types';
import { createSyncOperation } from './syncRepository';

function now(): string {
  return new Date().toISOString();
}

export async function createTimeEntry(
  db: AppDatabase,
  jobId: string,
  input: { durationMinutes: number; description?: string; startedAt?: string; endedAt?: string },
  userId: string = 'local_user'
): Promise<TimeEntry> {
  const id = uuidv4();
  const timestamp = now();

  const entry: TimeEntry = {
    id,
    jobId,
    userId,
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

export async function upsertTimeEntry(db: AppDatabase, remote: {
  id: string;
  jobId: string;
  userId: string;
  startedAt: string | null;
  endedAt: string | null;
  durationMinutes: number | null;
  description: string | null;
  billable: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}): Promise<void> {
  const existing = await db.getFirstAsync<{ id: string; updatedAt: string }>(
    'SELECT id, updatedAt FROM time_entries WHERE id = ?',
    [remote.id]
  );

  if (existing) {
    if (remote.updatedAt > existing.updatedAt) {
      await db.runAsync(
        `UPDATE time_entries SET jobId = ?, userId = ?, startedAt = ?, endedAt = ?, durationMinutes = ?, description = ?, billable = ?, syncStatus = ?, updatedAt = ?, deletedAt = ? WHERE id = ?`,
        [remote.jobId, remote.userId, remote.startedAt, remote.endedAt, remote.durationMinutes, remote.description, remote.billable ? 1 : 0, 'synced', remote.updatedAt, remote.deletedAt ?? null, remote.id]
      );
    }
  } else {
    await db.runAsync(
      `INSERT INTO time_entries (id, jobId, userId, startedAt, endedAt, durationMinutes, description, billable, createdAt, updatedAt, deletedAt, syncStatus)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [remote.id, remote.jobId, remote.userId, remote.startedAt, remote.endedAt, remote.durationMinutes, remote.description, remote.billable ? 1 : 0, remote.createdAt, remote.updatedAt, remote.deletedAt ?? null, 'synced']
    );
  }
}

export async function getTimeEntryById(db: AppDatabase, id: string): Promise<TimeEntry | null> {
  const row = await db.getFirstAsync<TimeEntry>(
    'SELECT * FROM time_entries WHERE id = ? AND deletedAt IS NULL',
    [id]
  );
  return row ?? null;
}

export async function updateTimeEntry(
  db: AppDatabase,
  id: string,
  updates: Partial<Pick<TimeEntry, 'durationMinutes' | 'description' | 'startedAt' | 'endedAt' | 'billable'>>
): Promise<TimeEntry | null> {
  const existing = await db.getFirstAsync<TimeEntry>(
    'SELECT * FROM time_entries WHERE id = ? AND deletedAt IS NULL',
    [id]
  );
  if (!existing) return null;

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (updates.durationMinutes !== undefined) { fields.push('durationMinutes = ?'); values.push(updates.durationMinutes); }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
  if (updates.startedAt !== undefined) { fields.push('startedAt = ?'); values.push(updates.startedAt); }
  if (updates.endedAt !== undefined) { fields.push('endedAt = ?'); values.push(updates.endedAt); }
  if (updates.billable !== undefined) { fields.push('billable = ?'); values.push(updates.billable ? 1 : 0); }

  if (fields.length === 0) return existing;

  fields.push('updatedAt = ?');
  values.push(now());
  values.push(id);

  await db.runAsync(
    `UPDATE time_entries SET ${fields.join(', ')} WHERE id = ?`,
    values
  );

  // Create sync operation for the update
  await createSyncOperation(db, {
    entityType: 'timeEntry',
    entityId: id,
    operationType: 'update',
    payloadJson: JSON.stringify({ ...updates, id }),
    status: 'pending',
  }).catch(() => {});

  return db.getFirstAsync<TimeEntry>(
    'SELECT * FROM time_entries WHERE id = ? AND deletedAt IS NULL',
    [id]
  );
}