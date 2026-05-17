import { v4 as uuidv4 } from 'uuid';
import type { Client } from '../../domain/types';
import type { AppDatabase } from './types';
import { createSyncOperation } from './syncRepository';

function now(): string {
  return new Date().toISOString();
}

export async function createClient(
  db: AppDatabase,
  input: { name: string; phone?: string; email?: string; notes?: string },
  userId: string = 'local_user'
): Promise<Client> {
  const id = uuidv4();
  const timestamp = now();
  const client: Client = {
    id,
    userId,
    name: input.name,
    phone: input.phone ?? null,
    email: input.email ?? null,
    notes: input.notes ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    syncStatus: 'local_only',
  };

  await db.runAsync(
    `INSERT INTO clients (id, userId, name, phone, email, notes, createdAt, updatedAt, deletedAt, syncStatus)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [client.id, client.userId, client.name, client.phone, client.email, client.notes, client.createdAt, client.updatedAt, client.deletedAt, client.syncStatus]
  );

  await createSyncOperation(db, {
    entityType: 'client',
    entityId: client.id,
    operationType: 'create',
    payloadJson: JSON.stringify(client),
    status: 'pending',
  }).catch(() => {});

  return client;
}

export async function getAllClients(db: AppDatabase): Promise<Client[]> {
  return db.getAllAsync<Client>(
    'SELECT * FROM clients WHERE deletedAt IS NULL ORDER BY name ASC'
  );
}

export async function getClientById(db: AppDatabase, id: string): Promise<Client | null> {
  const row = await db.getFirstAsync<Client>(
    'SELECT * FROM clients WHERE id = ? AND deletedAt IS NULL',
    [id]
  );
  return row ?? null;
}

export async function updateClient(
  db: AppDatabase,
  id: string,
  updates: Partial<Pick<Client, 'name' | 'phone' | 'email' | 'notes' | 'syncStatus'>>
): Promise<Client | null> {
  const existing = await getClientById(db, id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.phone !== undefined) { fields.push('phone = ?'); values.push(updates.phone); }
  if (updates.email !== undefined) { fields.push('email = ?'); values.push(updates.email); }
  if (updates.notes !== undefined) { fields.push('notes = ?'); values.push(updates.notes); }
  if (updates.syncStatus !== undefined) { fields.push('syncStatus = ?'); values.push(updates.syncStatus); }

  if (fields.length === 0) return existing;

  fields.push('updatedAt = ?');
  values.push(now());
  values.push(id);

  await db.runAsync(
    `UPDATE clients SET ${fields.join(', ')} WHERE id = ?`,
    values
  );

  await createSyncOperation(db, {
    entityType: 'client',
    entityId: id,
    operationType: 'update',
    payloadJson: JSON.stringify({ ...updates, id }),
    status: 'pending',
  }).catch(() => {});

  return getClientById(db, id);
}

export async function deleteClient(db: AppDatabase, id: string): Promise<boolean> {
  const timestamp = now();
  const result = await db.runAsync(
    'UPDATE clients SET deletedAt = ?, updatedAt = ? WHERE id = ?',
    [timestamp, timestamp, id]
  );

  if (result.changes > 0) {
    await createSyncOperation(db, {
      entityType: 'client',
      entityId: id,
      operationType: 'delete',
      payloadJson: JSON.stringify({ id, deletedAt: timestamp }),
      status: 'pending',
    }).catch(() => {});
  }

  return result.changes > 0;
}

export async function upsertClient(db: AppDatabase, remote: {
  id: string;
  userId: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}): Promise<void> {
  const existing = await db.getFirstAsync<{ id: string; updatedAt: string }>(
    'SELECT id, updatedAt FROM clients WHERE id = ?',
    [remote.id]
  );

  if (existing) {
    if (remote.updatedAt > existing.updatedAt) {
      await db.runAsync(
        `UPDATE clients SET userId = ?, name = ?, phone = ?, email = ?, notes = ?, syncStatus = ?, updatedAt = ?, deletedAt = ? WHERE id = ?`,
        [remote.userId, remote.name, remote.phone, remote.email, remote.notes, 'synced', remote.updatedAt, remote.deletedAt ?? null, remote.id]
      );
    }
  } else {
    await db.runAsync(
      `INSERT INTO clients (id, userId, name, phone, email, notes, createdAt, updatedAt, deletedAt, syncStatus)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [remote.id, remote.userId, remote.name, remote.phone, remote.email, remote.notes, remote.createdAt, remote.updatedAt, remote.deletedAt ?? null, 'synced']
    );
  }
}
