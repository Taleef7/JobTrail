import { v4 as uuidv4 } from 'uuid';
import type { MaterialLineItem } from '../../domain/types';
import type { AppDatabase } from './types';
import { createSyncOperation } from './syncRepository';

function now(): string {
  return new Date().toISOString();
}

export async function createMaterial(
  db: AppDatabase,
  jobId: string,
  input: { name: string; quantity?: number; unit?: string; unitCost?: number },
  userId: string = 'local_user'
): Promise<MaterialLineItem> {
  const id = uuidv4();
  const timestamp = now();
  const quantity = input.quantity ?? 1;
  const unitCost = input.unitCost ?? null;
  const totalCost = unitCost !== null ? quantity * unitCost : null;

  const material: MaterialLineItem = {
    id,
    jobId,
    userId,
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

export async function upsertMaterial(db: AppDatabase, remote: {
  id: string;
  jobId: string;
  userId: string;
  name: string;
  quantity: number;
  unit: string | null;
  unitCost: number | null;
  totalCost: number | null;
  billable: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}): Promise<void> {
  const existing = await db.getFirstAsync<{ id: string; updatedAt: string }>(
    'SELECT id, updatedAt FROM material_line_items WHERE id = ?',
    [remote.id]
  );

  if (existing) {
    if (remote.updatedAt > existing.updatedAt) {
      await db.runAsync(
        `UPDATE material_line_items SET jobId = ?, userId = ?, name = ?, quantity = ?, unit = ?, unitCost = ?, totalCost = ?, billable = ?, syncStatus = ?, updatedAt = ?, deletedAt = ? WHERE id = ?`,
        [remote.jobId, remote.userId, remote.name, remote.quantity, remote.unit, remote.unitCost, remote.totalCost, remote.billable ? 1 : 0, 'synced', remote.updatedAt, remote.deletedAt ?? null, remote.id]
      );
    }
  } else {
    await db.runAsync(
      `INSERT INTO material_line_items (id, jobId, userId, name, quantity, unit, unitCost, totalCost, billable, createdAt, updatedAt, deletedAt, syncStatus)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [remote.id, remote.jobId, remote.userId, remote.name, remote.quantity, remote.unit, remote.unitCost, remote.totalCost, remote.billable ? 1 : 0, remote.createdAt, remote.updatedAt, remote.deletedAt ?? null, 'synced']
    );
  }
}

export async function getMaterialById(db: AppDatabase, id: string): Promise<MaterialLineItem | null> {
  const row = await db.getFirstAsync<MaterialLineItem>(
    'SELECT * FROM material_line_items WHERE id = ? AND deletedAt IS NULL',
    [id]
  );
  return row ?? null;
}

export async function updateMaterial(
  db: AppDatabase,
  id: string,
  updates: Partial<Pick<MaterialLineItem, 'name' | 'quantity' | 'unit' | 'unitCost' | 'totalCost' | 'billable'>>
): Promise<MaterialLineItem | null> {
  // First get the existing material to find its jobId for the sync operation
  const existing = await db.getFirstAsync<MaterialLineItem>(
    'SELECT * FROM material_line_items WHERE id = ? AND deletedAt IS NULL',
    [id]
  );
  if (!existing) return null;

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.quantity !== undefined) { fields.push('quantity = ?'); values.push(updates.quantity); }
  if (updates.unit !== undefined) { fields.push('unit = ?'); values.push(updates.unit); }
  if (updates.unitCost !== undefined) { fields.push('unitCost = ?'); values.push(updates.unitCost); }
  if (updates.totalCost !== undefined) { fields.push('totalCost = ?'); values.push(updates.totalCost); }
  if (updates.billable !== undefined) { fields.push('billable = ?'); values.push(updates.billable ? 1 : 0); }

  if (fields.length === 0) return existing;

  fields.push('updatedAt = ?');
  values.push(now());
  values.push(id);

  await db.runAsync(
    `UPDATE material_line_items SET ${fields.join(', ')} WHERE id = ?`,
    values
  );

  // Create sync operation for the update
  await createSyncOperation(db, {
    entityType: 'material',
    entityId: id,
    operationType: 'update',
    payloadJson: JSON.stringify({ ...updates, id }),
    status: 'pending',
  }).catch(() => {});

  return db.getFirstAsync<MaterialLineItem>(
    'SELECT * FROM material_line_items WHERE id = ? AND deletedAt IS NULL',
    [id]
  );
}