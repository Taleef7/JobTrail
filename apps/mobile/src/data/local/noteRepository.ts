import { v4 as uuidv4 } from 'uuid';
import type { JobNote } from '../../domain/types';
import type { AppDatabase } from './types';
import { createSyncOperation } from './syncRepository';

const DEFAULT_USER_ID = 'local_user';

function now(): string {
  return new Date().toISOString();
}

export async function createNote(
  db: AppDatabase,
  jobId: string,
  input: { content: string; noteType?: string }
): Promise<JobNote> {
  const id = uuidv4();
  const timestamp = now();
  const note: JobNote = {
    id,
    jobId,
    userId: DEFAULT_USER_ID,
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