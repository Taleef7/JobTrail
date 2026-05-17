import { v4 as uuidv4 } from 'uuid';
import type { CustomerApproval } from '../../domain/types';
import type { AppDatabase } from './types';
import { createSyncOperation } from './syncRepository';

function now(): string {
  return new Date().toISOString();
}

export async function createApproval(
  db: AppDatabase,
  jobId: string,
  input: {
    customerName?: string;
    signatureLocalUri?: string;
    approvalNotes?: string;
  },
  userId: string = 'local_user'
): Promise<CustomerApproval> {
  const id = uuidv4();
  const timestamp = now();
  const approval: CustomerApproval = {
    id,
    jobId,
    userId,
    customerName: input.customerName ?? null,
    signatureLocalUri: input.signatureLocalUri ?? null,
    signatureRemoteUrl: null,
    approvedAt: timestamp,
    approvalNotes: input.approvalNotes ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    syncStatus: 'local_only',
  };

  await db.runAsync(
    `INSERT INTO customer_approvals (id, jobId, userId, customerName, signatureLocalUri, signatureRemoteUrl, approvedAt, approvalNotes, createdAt, updatedAt, deletedAt, syncStatus)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      approval.id, approval.jobId, approval.userId, approval.customerName,
      approval.signatureLocalUri, approval.signatureRemoteUrl, approval.approvedAt,
      approval.approvalNotes, approval.createdAt, approval.updatedAt,
      approval.deletedAt, approval.syncStatus,
    ]
  );

  await createSyncOperation(db, {
    entityType: 'customer_approval',
    entityId: approval.id,
    operationType: 'create',
    payloadJson: JSON.stringify(approval),
    status: 'pending',
  }).catch(() => {});

  return approval;
}

export async function getApprovalsByJobId(db: AppDatabase, jobId: string): Promise<CustomerApproval[]> {
  return db.getAllAsync<CustomerApproval>(
    'SELECT * FROM customer_approvals WHERE jobId = ? AND deletedAt IS NULL ORDER BY approvedAt DESC',
    [jobId]
  );
}

export async function getApprovalById(db: AppDatabase, id: string): Promise<CustomerApproval | null> {
  const row = await db.getFirstAsync<CustomerApproval>(
    'SELECT * FROM customer_approvals WHERE id = ? AND deletedAt IS NULL',
    [id]
  );
  return row ?? null;
}

export async function deleteApproval(db: AppDatabase, id: string): Promise<boolean> {
  const timestamp = now();
  const result = await db.runAsync(
    'UPDATE customer_approvals SET deletedAt = ?, updatedAt = ? WHERE id = ?',
    [timestamp, timestamp, id]
  );

  if (result.changes > 0) {
    await createSyncOperation(db, {
      entityType: 'customer_approval',
      entityId: id,
      operationType: 'delete',
      payloadJson: JSON.stringify({ id, deletedAt: timestamp }),
      status: 'pending',
    }).catch(() => {});
  }

  return result.changes > 0;
}

export async function upsertApproval(db: AppDatabase, remote: {
  id: string;
  jobId: string;
  userId: string;
  customerName: string | null;
  signatureLocalUri: string | null;
  signatureRemoteUrl: string | null;
  approvedAt: string | null;
  approvalNotes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}): Promise<void> {
  const existing = await db.getFirstAsync<{ id: string; updatedAt: string }>(
    'SELECT id, updatedAt FROM customer_approvals WHERE id = ?',
    [remote.id]
  );

  if (existing) {
    if (remote.updatedAt > existing.updatedAt) {
      await db.runAsync(
        `UPDATE customer_approvals SET jobId = ?, userId = ?, customerName = ?, signatureLocalUri = ?, signatureRemoteUrl = ?, approvedAt = ?, approvalNotes = ?, syncStatus = ?, updatedAt = ?, deletedAt = ? WHERE id = ?`,
        [remote.jobId, remote.userId, remote.customerName, remote.signatureLocalUri, remote.signatureRemoteUrl, remote.approvedAt, remote.approvalNotes, 'synced', remote.updatedAt, remote.deletedAt ?? null, remote.id]
      );
    }
  } else {
    await db.runAsync(
      `INSERT INTO customer_approvals (id, jobId, userId, customerName, signatureLocalUri, signatureRemoteUrl, approvedAt, approvalNotes, syncStatus, createdAt, updatedAt, deletedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [remote.id, remote.jobId, remote.userId, remote.customerName, remote.signatureLocalUri, remote.signatureRemoteUrl, remote.approvedAt, remote.approvalNotes, 'synced', remote.createdAt, remote.updatedAt, remote.deletedAt ?? null]
    );
  }
}