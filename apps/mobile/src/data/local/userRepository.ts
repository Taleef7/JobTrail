import { v4 as uuidv4 } from 'uuid';
import type { User } from '../../domain/types';
import type { AppDatabase } from './types';

function now(): string {
  return new Date().toISOString();
}

export async function createUser(
  db: AppDatabase,
  input: Omit<User, 'id' | 'createdAt' | 'updatedAt'>
): Promise<User> {
  const id = uuidv4();
  const timestamp = now();
  const user: User = {
    ...input,
    id,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await db.runAsync(
    `INSERT INTO users (id, cloudUid, email, displayName, createdAt, updatedAt, lastSyncedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [user.id, user.cloudUid, user.email, user.displayName, user.createdAt, user.updatedAt, user.lastSyncedAt]
  );

  return user;
}

export async function getUserByCloudUid(db: AppDatabase, cloudUid: string): Promise<User | null> {
  const row = await db.getFirstAsync<User>(
    'SELECT * FROM users WHERE cloudUid = ?',
    [cloudUid]
  );
  return row ?? null;
}

export async function updateUser(
  db: AppDatabase,
  id: string,
  updates: Partial<User>
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
    `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
}