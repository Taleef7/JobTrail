import { v4 as uuidv4 } from 'uuid';
import type { Site } from '../../domain/types';
import type { AppDatabase } from './types';
import { createSyncOperation } from './syncRepository';

function now(): string {
  return new Date().toISOString();
}

export async function createSite(
  db: AppDatabase,
  input: { clientId?: string; name?: string; addressLine1?: string; addressLine2?: string; city?: string; state?: string; postalCode?: string; country?: string; notes?: string },
  userId: string = 'local_user'
): Promise<Site> {
  const id = uuidv4();
  const timestamp = now();
  const site: Site = {
    id,
    userId,
    clientId: input.clientId ?? null,
    name: input.name ?? null,
    addressLine1: input.addressLine1 ?? null,
    addressLine2: input.addressLine2 ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    postalCode: input.postalCode ?? null,
    country: input.country ?? null,
    notes: input.notes ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    syncStatus: 'local_only',
  };

  await db.runAsync(
    `INSERT INTO sites (id, userId, clientId, name, addressLine1, addressLine2, city, state, postalCode, country, notes, createdAt, updatedAt, deletedAt, syncStatus)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [site.id, site.userId, site.clientId, site.name, site.addressLine1, site.addressLine2, site.city, site.state, site.postalCode, site.country, site.notes, site.createdAt, site.updatedAt, site.deletedAt, site.syncStatus]
  );

  await createSyncOperation(db, {
    entityType: 'site',
    entityId: site.id,
    operationType: 'create',
    payloadJson: JSON.stringify(site),
    status: 'pending',
  }).catch(() => {});

  return site;
}

export async function getAllSites(db: AppDatabase): Promise<Site[]> {
  return db.getAllAsync<Site>(
    'SELECT * FROM sites WHERE deletedAt IS NULL ORDER BY name ASC'
  );
}

export async function getSitesByClientId(db: AppDatabase, clientId: string): Promise<Site[]> {
  return db.getAllAsync<Site>(
    'SELECT * FROM sites WHERE clientId = ? AND deletedAt IS NULL ORDER BY name ASC',
    [clientId]
  );
}

export async function getSiteById(db: AppDatabase, id: string): Promise<Site | null> {
  const row = await db.getFirstAsync<Site>(
    'SELECT * FROM sites WHERE id = ? AND deletedAt IS NULL',
    [id]
  );
  return row ?? null;
}

export async function updateSite(
  db: AppDatabase,
  id: string,
  updates: Partial<Pick<Site, 'name' | 'addressLine1' | 'addressLine2' | 'city' | 'state' | 'postalCode' | 'country' | 'notes' | 'clientId' | 'syncStatus'>>
): Promise<Site | null> {
  const existing = await getSiteById(db, id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.addressLine1 !== undefined) { fields.push('addressLine1 = ?'); values.push(updates.addressLine1); }
  if (updates.addressLine2 !== undefined) { fields.push('addressLine2 = ?'); values.push(updates.addressLine2); }
  if (updates.city !== undefined) { fields.push('city = ?'); values.push(updates.city); }
  if (updates.state !== undefined) { fields.push('state = ?'); values.push(updates.state); }
  if (updates.postalCode !== undefined) { fields.push('postalCode = ?'); values.push(updates.postalCode); }
  if (updates.country !== undefined) { fields.push('country = ?'); values.push(updates.country); }
  if (updates.notes !== undefined) { fields.push('notes = ?'); values.push(updates.notes); }
  if (updates.clientId !== undefined) { fields.push('clientId = ?'); values.push(updates.clientId); }
  if (updates.syncStatus !== undefined) { fields.push('syncStatus = ?'); values.push(updates.syncStatus); }

  if (fields.length === 0) return existing;

  fields.push('updatedAt = ?');
  values.push(now());
  values.push(id);

  await db.runAsync(
    `UPDATE sites SET ${fields.join(', ')} WHERE id = ?`,
    values
  );

  await createSyncOperation(db, {
    entityType: 'site',
    entityId: id,
    operationType: 'update',
    payloadJson: JSON.stringify({ ...updates, id }),
    status: 'pending',
  }).catch(() => {});

  return getSiteById(db, id);
}

export async function deleteSite(db: AppDatabase, id: string): Promise<boolean> {
  const timestamp = now();
  const result = await db.runAsync(
    'UPDATE sites SET deletedAt = ?, updatedAt = ? WHERE id = ?',
    [timestamp, timestamp, id]
  );

  if (result.changes > 0) {
    await createSyncOperation(db, {
      entityType: 'site',
      entityId: id,
      operationType: 'delete',
      payloadJson: JSON.stringify({ id, deletedAt: timestamp }),
      status: 'pending',
    }).catch(() => {});
  }

  return result.changes > 0;
}

export async function upsertSite(db: AppDatabase, remote: {
  id: string;
  userId: string;
  clientId: string | null;
  name: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}): Promise<void> {
  const existing = await db.getFirstAsync<{ id: string; updatedAt: string }>(
    'SELECT id, updatedAt FROM sites WHERE id = ?',
    [remote.id]
  );

  if (existing) {
    if (remote.updatedAt > existing.updatedAt) {
      await db.runAsync(
        `UPDATE sites SET userId = ?, clientId = ?, name = ?, addressLine1 = ?, addressLine2 = ?, city = ?, state = ?, postalCode = ?, country = ?, notes = ?, syncStatus = ?, updatedAt = ?, deletedAt = ? WHERE id = ?`,
        [remote.userId, remote.clientId, remote.name, remote.addressLine1, remote.addressLine2, remote.city, remote.state, remote.postalCode, remote.country, remote.notes, 'synced', remote.updatedAt, remote.deletedAt ?? null, remote.id]
      );
    }
  } else {
    await db.runAsync(
      `INSERT INTO sites (id, userId, clientId, name, addressLine1, addressLine2, city, state, postalCode, country, notes, createdAt, updatedAt, deletedAt, syncStatus)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [remote.id, remote.userId, remote.clientId, remote.name, remote.addressLine1, remote.addressLine2, remote.city, remote.state, remote.postalCode, remote.country, remote.notes, remote.createdAt, remote.updatedAt, remote.deletedAt ?? null, 'synced']
    );
  }
}
