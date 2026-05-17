import { v4 as uuidv4 } from 'uuid';
import type { PhotoAsset } from '../../domain/types';
import type { AppDatabase } from './types';

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

  return photo;
}

export async function getPhotosByJobId(db: AppDatabase, jobId: string): Promise<PhotoAsset[]> {
  return db.getAllAsync<PhotoAsset>(
    `SELECT * FROM photo_assets WHERE jobId = ? AND deletedAt IS NULL ORDER BY createdAt ASC`,
    [jobId]
  );
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
}