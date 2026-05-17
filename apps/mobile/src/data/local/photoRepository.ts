import { v4 as uuidv4 } from 'uuid';
import type { PhotoAsset } from '../../domain/types';
import type { AppDatabase } from './types';
import { createSyncOperation } from './syncRepository';

function now(): string {
  return new Date().toISOString();
}

export async function createPhoto(
  db: AppDatabase,
  jobId: string,
  opts: Omit<PhotoAsset, 'id' | 'jobId' | 'createdAt' | 'updatedAt' | 'deletedAt'>
): Promise<PhotoAsset> {
  const id = uuidv4();
  const timestamp = now();
  const photo: PhotoAsset = {
    ...opts,
    id,
    jobId,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };

  await db.runAsync(
    `INSERT INTO photo_assets (id, jobId, userId, localUri, remoteUrl, photoType, caption, takenAt, uploadStatus, syncStatus, createdAt, updatedAt, deletedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      photo.id, photo.jobId, photo.userId, photo.localUri, photo.remoteUrl,
      photo.photoType, photo.caption, photo.takenAt, photo.uploadStatus,
      photo.syncStatus, photo.createdAt, photo.updatedAt, photo.deletedAt,
    ]
  );

  // Create sync operation for photo metadata
  await createSyncOperation(db, {
    entityType: 'photo',
    entityId: photo.id,
    operationType: 'create',
    payloadJson: JSON.stringify(photo),
    status: 'pending',
  }).catch(() => {}); // Non-critical — don't fail the main operation

  return photo;
}

export async function getPhotosByJobId(db: AppDatabase, jobId: string): Promise<PhotoAsset[]> {
  return db.getAllAsync<PhotoAsset>(
    `SELECT * FROM photo_assets WHERE jobId = ? AND deletedAt IS NULL ORDER BY createdAt ASC`,
    [jobId]
  );
}

export async function getPhotoById(db: AppDatabase, id: string): Promise<PhotoAsset | null> {
  const row = await db.getFirstAsync<PhotoAsset>(
    'SELECT * FROM photo_assets WHERE id = ?',
    [id]
  );
  return row ?? null;
}

export async function updatePhoto(
  db: AppDatabase,
  id: string,
  updates: Partial<PhotoAsset>
): Promise<void> {
  const excluded = new Set(['id', 'createdAt']);
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (excluded.has(key)) continue;
    fields.push(`${key} = ?`);
    values.push(value as string | number | null);
  }

  if (fields.length === 0) return;

  fields.push('updatedAt = ?');
  values.push(now());
  values.push(id);

  await db.runAsync(
    `UPDATE photo_assets SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
}

export async function deletePhoto(db: AppDatabase, id: string): Promise<void> {
  const timestamp = now();
  await db.runAsync(
    `UPDATE photo_assets SET deletedAt = ?, updatedAt = ? WHERE id = ?`,
    [timestamp, timestamp, id]
  );

  // Create sync operation for the delete
  await createSyncOperation(db, {
    entityType: 'photo',
    entityId: id,
    operationType: 'delete',
    payloadJson: JSON.stringify({ id, deletedAt: timestamp }),
    status: 'pending',
  }).catch(() => {}); // Non-critical — don't fail the main operation
}

export async function upsertPhoto(db: AppDatabase, remote: {
  id: string;
  jobId: string;
  userId: string;
  localUri: string;
  remoteUrl: string | null;
  photoType: string;
  caption: string | null;
  takenAt: string | null;
  uploadStatus: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}): Promise<void> {
  const existing = await db.getFirstAsync<{ id: string; updatedAt: string }>(
    'SELECT id, updatedAt FROM photo_assets WHERE id = ?',
    [remote.id]
  );

  if (existing) {
    if (remote.updatedAt > existing.updatedAt) {
      await db.runAsync(
        `UPDATE photo_assets SET jobId = ?, userId = ?, localUri = ?, remoteUrl = ?, photoType = ?, caption = ?, takenAt = ?, uploadStatus = ?, syncStatus = ?, updatedAt = ?, deletedAt = ? WHERE id = ?`,
        [remote.jobId, remote.userId, remote.localUri, remote.remoteUrl, remote.photoType, remote.caption, remote.takenAt, remote.uploadStatus, 'synced', remote.updatedAt, remote.deletedAt ?? null, remote.id]
      );
    }
  } else {
    await db.runAsync(
      `INSERT INTO photo_assets (id, jobId, userId, localUri, remoteUrl, photoType, caption, takenAt, uploadStatus, syncStatus, createdAt, updatedAt, deletedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [remote.id, remote.jobId, remote.userId, remote.localUri, remote.remoteUrl, remote.photoType, remote.caption, remote.takenAt, remote.uploadStatus, 'synced', remote.createdAt, remote.updatedAt, remote.deletedAt ?? null]
    );
  }
}