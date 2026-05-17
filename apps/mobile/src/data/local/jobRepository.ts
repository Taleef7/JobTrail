import { v4 as uuidv4 } from 'uuid';
import type { Job } from '../../domain/types';
import type { AppDatabase } from './types';
import { createSyncOperation } from './syncRepository';

const DEFAULT_USER_ID = 'local_user';

function now(): string {
  return new Date().toISOString();
}

export function generateId(): string {
  return uuidv4();
}

export async function createJob(
  db: AppDatabase,
  input: { title: string; jobType?: string; priority?: string; roughNotes?: string }
): Promise<Job> {
  const id = generateId();
  const timestamp = now();
  const job: Job = {
    id,
    userId: DEFAULT_USER_ID,
    title: input.title,
    jobType: input.jobType ?? null,
    status: 'draft',
    priority: input.priority ?? 'normal',
    roughNotes: input.roughNotes ?? null,
    structuredSummary: null,
    internalNotes: null,
    customerVisibleSummary: null,
    aiStatus: 'not_started',
    syncStatus: 'local_only',
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await db.runAsync(
    `INSERT INTO jobs (id, userId, title, jobType, status, priority, roughNotes, structuredSummary, internalNotes, customerVisibleSummary, aiStatus, syncStatus, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      job.id, job.userId, job.title, job.jobType, job.status, job.priority,
      job.roughNotes, job.structuredSummary, job.internalNotes, job.customerVisibleSummary,
      job.aiStatus, job.syncStatus, job.createdAt, job.updatedAt,
    ]
  );

  // Create sync operation
  await createSyncOperation(db, {
    entityType: 'job',
    entityId: job.id,
    operationType: 'create',
    payloadJson: JSON.stringify(job),
    status: 'pending',
  }).catch(() => {}); // Non-critical — don't fail the main operation

  return job;
}

export async function getJobById(db: AppDatabase, id: string): Promise<Job | null> {
  const row = await db.getFirstAsync<Job>(
    'SELECT * FROM jobs WHERE id = ? AND deletedAt IS NULL',
    [id]
  );
  return row ?? null;
}

export async function getAllJobs(db: AppDatabase): Promise<Job[]> {
  return db.getAllAsync<Job>(
    'SELECT * FROM jobs WHERE deletedAt IS NULL ORDER BY updatedAt DESC'
  );
}

export async function updateJob(
  db: AppDatabase,
  id: string,
  updates: Partial<Pick<Job, 'title' | 'jobType' | 'status' | 'priority' | 'roughNotes' | 'structuredSummary' | 'internalNotes' | 'customerVisibleSummary' | 'aiStatus' | 'syncStatus'>>
): Promise<Job | null> {
  const existing = await getJobById(db, id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.jobType !== undefined) { fields.push('jobType = ?'); values.push(updates.jobType); }
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.priority !== undefined) { fields.push('priority = ?'); values.push(updates.priority); }
  if (updates.roughNotes !== undefined) { fields.push('roughNotes = ?'); values.push(updates.roughNotes); }
  if (updates.structuredSummary !== undefined) { fields.push('structuredSummary = ?'); values.push(updates.structuredSummary); }
  if (updates.internalNotes !== undefined) { fields.push('internalNotes = ?'); values.push(updates.internalNotes); }
  if (updates.customerVisibleSummary !== undefined) { fields.push('customerVisibleSummary = ?'); values.push(updates.customerVisibleSummary); }
  if (updates.aiStatus !== undefined) { fields.push('aiStatus = ?'); values.push(updates.aiStatus); }
  if (updates.syncStatus !== undefined) { fields.push('syncStatus = ?'); values.push(updates.syncStatus); }

  if (fields.length === 0) return existing;

  fields.push('updatedAt = ?');
  values.push(now());
  values.push(id);

  await db.runAsync(
    `UPDATE jobs SET ${fields.join(', ')} WHERE id = ?`,
    values
  );

  // Create sync operation for the update
  await createSyncOperation(db, {
    entityType: 'job',
    entityId: id,
    operationType: 'update',
    payloadJson: JSON.stringify({ ...updates, id }),
    status: 'pending',
  }).catch(() => {}); // Non-critical — don't fail the main operation

  return getJobById(db, id);
}

export async function deleteJob(db: AppDatabase, id: string): Promise<boolean> {
  const timestamp = now();
  const result = await db.runAsync(
    'UPDATE jobs SET deletedAt = ?, updatedAt = ? WHERE id = ?',
    [timestamp, timestamp, id]
  );

  // Create sync operation for the delete
  if (result.changes > 0) {
    await createSyncOperation(db, {
      entityType: 'job',
      entityId: id,
      operationType: 'delete',
      payloadJson: JSON.stringify({ id, deletedAt: timestamp }),
      status: 'pending',
    }).catch(() => {}); // Non-critical — don't fail the main operation
  }

  return result.changes > 0;
}