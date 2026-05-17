import { v4 as uuidv4 } from 'uuid';
import type { SyncOperation } from '../../domain/types';
import type { AppDatabase } from './types';

function now(): string {
  return new Date().toISOString();
}

export async function createSyncOperation(
  db: AppDatabase,
  op: Pick<SyncOperation, 'entityType' | 'entityId' | 'operationType' | 'payloadJson' | 'status'>
): Promise<SyncOperation> {
  const id = uuidv4();
  const timestamp = now();
  const syncOp: SyncOperation = {
    id,
    entityType: op.entityType,
    entityId: op.entityId,
    operationType: op.operationType,
    payloadJson: op.payloadJson,
    status: op.status,
    retryCount: 0,
    lastError: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    processedAt: null,
  };

  await db.runAsync(
    `INSERT INTO sync_operations (id, entityType, entityId, operationType, payloadJson, status, retryCount, lastError, createdAt, updatedAt, processedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      syncOp.id, syncOp.entityType, syncOp.entityId, syncOp.operationType,
      syncOp.payloadJson, syncOp.status, syncOp.retryCount, syncOp.lastError,
      syncOp.createdAt, syncOp.updatedAt, syncOp.processedAt,
    ]
  );

  return syncOp;
}

export async function getPendingSyncOperations(db: AppDatabase): Promise<SyncOperation[]> {
  return db.getAllAsync<SyncOperation>(
    'SELECT * FROM sync_operations WHERE status = ? ORDER BY createdAt ASC',
    ['pending']
  );
}

export async function updateSyncOperation(
  db: AppDatabase,
  id: string,
  updates: Partial<SyncOperation>
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
    `UPDATE sync_operations SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
}

export async function getSyncOperationsByEntity(
  db: AppDatabase,
  entityType: string,
  entityId: string
): Promise<SyncOperation[]> {
  return db.getAllAsync<SyncOperation>(
    'SELECT * FROM sync_operations WHERE entityType = ? AND entityId = ? ORDER BY createdAt DESC',
    [entityType, entityId]
  );
}