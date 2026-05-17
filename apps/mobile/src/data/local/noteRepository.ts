import { v4 as uuidv4 } from 'uuid';
import type { JobNote } from '../../domain/types';
import type { AppDatabase } from './types';
import { createSyncOperation } from './syncRepository';

function now(): string {
  return new Date().toISOString();
}

export async function createNote(
  db: AppDatabase,
  jobId: string,
  input: { content: string; noteType?: string },
  userId: string = 'local_user'
): Promise<JobNote> {
  const id = uuidv4();
  const timestamp = now();
  const note: JobNote = {
    id,
    jobId,
    userId,
    noteType: (input.noteType as JobNote['noteType']) ?? 'manual',
    content: input.content,
    createdAt: timestamp,
    updatedAt: timestamp,
    syncStatus: 'local_only',
  };

  await db.runAsync(
    `INSERT INTO job_notes (id, jobId, userId, noteType, content, createdAt, updatedAt, syncStatus)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [note.id, note.jobId, note.userId, note.noteType, note.content, note.createdAt, note.updatedAt, note.syncStatus]
  );

  // Create sync operation
  await createSyncOperation(db, {
    entityType: 'note',
    entityId: note.id,
    operationType: 'create',
    payloadJson: JSON.stringify(note),
    status: 'pending',
  }).catch(() => {}); // Non-critical — don't fail the main operation

  return note;
}

export async function getNotesByJobId(db: AppDatabase, jobId: string): Promise<JobNote[]> {
  return db.getAllAsync<JobNote>(
    'SELECT * FROM job_notes WHERE jobId = ? AND deletedAt IS NULL ORDER BY createdAt ASC',
    [jobId]
  );
}

export async function getNoteById(db: AppDatabase, id: string): Promise<JobNote | null> {
  const row = await db.getFirstAsync<JobNote>(
    'SELECT * FROM job_notes WHERE id = ? AND deletedAt IS NULL',
    [id]
  );
  return row ?? null;
}

export async function deleteNote(db: AppDatabase, id: string): Promise<boolean> {
  const timestamp = now();
  const result = await db.runAsync(
    'UPDATE job_notes SET deletedAt = ?, updatedAt = ? WHERE id = ?',
    [timestamp, timestamp, id]
  );

  // Create sync operation for the delete
  if (result.changes > 0) {
    await createSyncOperation(db, {
      entityType: 'note',
      entityId: id,
      operationType: 'delete',
      payloadJson: JSON.stringify({ id, deletedAt: timestamp }),
      status: 'pending',
    }).catch(() => {}); // Non-critical — don't fail the main operation
  }

  return result.changes > 0;
}

export async function upsertNote(db: AppDatabase, remote: {
  id: string;
  jobId: string;
  userId: string;
  noteType: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}): Promise<void> {
  const existing = await db.getFirstAsync<{ id: string; updatedAt: string }>(
    'SELECT id, updatedAt FROM job_notes WHERE id = ?',
    [remote.id]
  );

  if (existing) {
    if (remote.updatedAt > existing.updatedAt) {
      await db.runAsync(
        `UPDATE job_notes SET jobId = ?, userId = ?, noteType = ?, content = ?, syncStatus = ?, updatedAt = ?, deletedAt = ? WHERE id = ?`,
        [remote.jobId, remote.userId, remote.noteType, remote.content, 'synced', remote.updatedAt, remote.deletedAt ?? null, remote.id]
      );
    }
  } else {
    await db.runAsync(
      `INSERT INTO job_notes (id, jobId, userId, noteType, content, createdAt, updatedAt, deletedAt, syncStatus)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [remote.id, remote.jobId, remote.userId, remote.noteType, remote.content, remote.createdAt, remote.updatedAt, remote.deletedAt ?? null, 'synced']
    );
  }
}

export async function updateNote(
  db: AppDatabase,
  id: string,
  updates: Partial<Pick<JobNote, 'content' | 'noteType'>>
): Promise<JobNote | null> {
  const existing = await getNoteById(db, id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (updates.content !== undefined) { fields.push('content = ?'); values.push(updates.content); }
  if (updates.noteType !== undefined) { fields.push('noteType = ?'); values.push(updates.noteType); }

  if (fields.length === 0) return existing;

  fields.push('updatedAt = ?');
  values.push(now());
  values.push(id);

  await db.runAsync(
    `UPDATE job_notes SET ${fields.join(', ')} WHERE id = ?`,
    values
  );

  // Create sync operation for the update
  await createSyncOperation(db, {
    entityType: 'note',
    entityId: id,
    operationType: 'update',
    payloadJson: JSON.stringify({ ...updates, id }),
    status: 'pending',
  }).catch(() => {});

  return getNoteById(db, id);
}