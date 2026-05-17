import { v4 as uuidv4 } from 'uuid';
import type { MaterialLineItem } from '../../domain/types';
import type { AppDatabase } from './types';
import { createSyncOperation } from './syncRepository';

const DEFAULT_USER_ID = 'local_user';

function now(): string {
  return new Date().toISOString();
}

export async function createMaterial(
  db: AppDatabase,
  jobId: string,
  input: { name: string; quantity?: number; unit?: string; unitCost?: number }
): Promise<MaterialLineItem> {
  const id = uuidv4();
  const timestamp = now();
  const quantity = input.quantity ?? 1;
  const unitCost = input.unitCost ?? null;
  const totalCost = unitCost !== null ? quantity * unitCost : null;

  const material: MaterialLineItem = {
    id,
    jobId,
    userId: DEFAULT_USER_ID,
    name: input.name,
    quantity,
    unit: input.unit ?? null,
    unitCost,
    totalCost,
    billable: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    syncStatus: 'local_only',
  };

  await db.runAsync(
    `INSERT INTO material_line_items (id, jobId, userId, name, quantity, unit, unitCost, totalCost, billable, createdAt, updatedAt, syncStatus)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      material.id, material.jobId, material.userId, material.name,
      material.quantity, material.unit, material.unitCost, material.totalCost,
      material.billable ? 1 : 0, material.createdAt, material.updatedAt, material.syncStatus,
    ]
  );

  // Create sync operation
  await createSyncOperation(db, {
    entityType: 'material',
    entityId: material.id,
    operationType: 'create',
    payloadJson: JSON.stringify(material),
    status: 'pending',
  }).catch(() => {}); // Non-critical — don't fail the main operation

  return material;
}

export async function getMaterialsByJobId(db: AppDatabase, jobId: string): Promise<MaterialLineItem[]> {
  return db.getAllAsync<MaterialLineItem>(
    'SELECT * FROM material_line_items WHERE jobId = ? AND deletedAt IS NULL ORDER BY createdAt ASC',
    [jobId]
  );
}

export async function deleteMaterial(db: AppDatabase, id: string): Promise<boolean> {
  const timestamp = now();
  const result = await db.runAsync(
    'UPDATE material_line_items SET deletedAt = ?, updatedAt = ? WHERE id = ?',
    [timestamp, timestamp, id]
  );

  // Create sync operation for the delete
  if (result.changes > 0) {
    await createSyncOperation(db, {
      entityType: 'material',
      entityId: id,
      operationType: 'delete',
      payloadJson: JSON.stringify({ id, deletedAt: timestamp }),
      status: 'pending',
    }).catch(() => {}); // Non-critical — don't fail the main operation
  }

  return result.changes > 0;
}