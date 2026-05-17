import { v4 as uuidv4 } from 'uuid';
import type { VoiceNote } from '../../domain/types';
import type { AppDatabase } from './types';
import { createSyncOperation } from './syncRepository';

function now(): string {
  return new Date().toISOString();
}

export async function createVoiceNote(
  db: AppDatabase,
  jobId: string,
  input: {
    localAudioUri?: string;
    durationSeconds?: number;
    transcript?: string;
    transcriptSource?: string;
  },
  userId: string = 'local_user'
): Promise<VoiceNote> {
  const id = uuidv4();
  const timestamp = now();
  const voiceNote: VoiceNote = {
    id,
    jobId,
    userId,
    localAudioUri: input.localAudioUri ?? null,
    durationSeconds: input.durationSeconds ?? null,
    transcript: input.transcript ?? null,
    transcriptSource: input.transcriptSource ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    syncStatus: 'local_only',
  };

  await db.runAsync(
    `INSERT INTO voice_notes (id, jobId, userId, localAudioUri, durationSeconds, transcript, transcriptSource, createdAt, updatedAt, deletedAt, syncStatus)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      voiceNote.id, voiceNote.jobId, voiceNote.userId, voiceNote.localAudioUri,
      voiceNote.durationSeconds, voiceNote.transcript, voiceNote.transcriptSource,
      voiceNote.createdAt, voiceNote.updatedAt, voiceNote.deletedAt, voiceNote.syncStatus,
    ]
  );

  await createSyncOperation(db, {
    entityType: 'voice_note',
    entityId: voiceNote.id,
    operationType: 'create',
    payloadJson: JSON.stringify(voiceNote),
    status: 'pending',
  }).catch(() => {});

  return voiceNote;
}

export async function getVoiceNotesByJobId(db: AppDatabase, jobId: string): Promise<VoiceNote[]> {
  return db.getAllAsync<VoiceNote>(
    'SELECT * FROM voice_notes WHERE jobId = ? AND deletedAt IS NULL ORDER BY createdAt DESC',
    [jobId]
  );
}

export async function getVoiceNoteById(db: AppDatabase, id: string): Promise<VoiceNote | null> {
  const row = await db.getFirstAsync<VoiceNote>(
    'SELECT * FROM voice_notes WHERE id = ? AND deletedAt IS NULL',
    [id]
  );
  return row ?? null;
}

export async function updateVoiceNote(
  db: AppDatabase,
  id: string,
  updates: Partial<Pick<VoiceNote, 'transcript' | 'transcriptSource' | 'durationSeconds'>>
): Promise<VoiceNote | null> {
  const existing = await getVoiceNoteById(db, id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (updates.transcript !== undefined) { fields.push('transcript = ?'); values.push(updates.transcript); }
  if (updates.transcriptSource !== undefined) { fields.push('transcriptSource = ?'); values.push(updates.transcriptSource); }
  if (updates.durationSeconds !== undefined) { fields.push('durationSeconds = ?'); values.push(updates.durationSeconds); }

  if (fields.length === 0) return existing;

  fields.push('updatedAt = ?');
  values.push(now());
  values.push(id);

  await db.runAsync(
    `UPDATE voice_notes SET ${fields.join(', ')} WHERE id = ?`,
    values
  );

  await createSyncOperation(db, {
    entityType: 'voice_note',
    entityId: id,
    operationType: 'update',
    payloadJson: JSON.stringify({ ...updates, id }),
    status: 'pending',
  }).catch(() => {});

  return getVoiceNoteById(db, id);
}

export async function deleteVoiceNote(db: AppDatabase, id: string): Promise<boolean> {
  const timestamp = now();
  const result = await db.runAsync(
    'UPDATE voice_notes SET deletedAt = ?, updatedAt = ? WHERE id = ?',
    [timestamp, timestamp, id]
  );

  if (result.changes > 0) {
    await createSyncOperation(db, {
      entityType: 'voice_note',
      entityId: id,
      operationType: 'delete',
      payloadJson: JSON.stringify({ id, deletedAt: timestamp }),
      status: 'pending',
    }).catch(() => {});
  }

  return result.changes > 0;
}

export async function upsertVoiceNote(db: AppDatabase, remote: {
  id: string;
  jobId: string;
  userId: string;
  localAudioUri: string | null;
  durationSeconds: number | null;
  transcript: string | null;
  transcriptSource: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}): Promise<void> {
  const existing = await db.getFirstAsync<{ id: string; updatedAt: string }>(
    'SELECT id, updatedAt FROM voice_notes WHERE id = ?',
    [remote.id]
  );

  if (existing) {
    if (remote.updatedAt > existing.updatedAt) {
      await db.runAsync(
        `UPDATE voice_notes SET jobId = ?, userId = ?, localAudioUri = ?, durationSeconds = ?, transcript = ?, transcriptSource = ?, syncStatus = ?, updatedAt = ?, deletedAt = ? WHERE id = ?`,
        [remote.jobId, remote.userId, remote.localAudioUri, remote.durationSeconds, remote.transcript, remote.transcriptSource, 'synced', remote.updatedAt, remote.deletedAt ?? null, remote.id]
      );
    }
  } else {
    await db.runAsync(
      `INSERT INTO voice_notes (id, jobId, userId, localAudioUri, durationSeconds, transcript, transcriptSource, syncStatus, createdAt, updatedAt, deletedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [remote.id, remote.jobId, remote.userId, remote.localAudioUri, remote.durationSeconds, remote.transcript, remote.transcriptSource, 'synced', remote.createdAt, remote.updatedAt, remote.deletedAt ?? null]
    );
  }
}