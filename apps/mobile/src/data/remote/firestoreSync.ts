import { db } from './firebaseConfig';
import { collection, doc, setDoc, deleteDoc } from 'firebase/firestore';
import type { AppDatabase } from '../local/types';
import { getPendingSyncOperations, updateSyncOperation } from '../local/syncRepository';
import { getJobById } from '../local/jobRepository';
import { getNotesByJobId } from '../local/noteRepository';
import { getMaterialsByJobId } from '../local/materialRepository';
import { getTimeEntriesByJobId } from '../local/timeEntryRepository';
import { getPhotosByJobId, updatePhoto } from '../local/photoRepository';
import { uploadPhoto } from './storageService';

let firebaseAvailable = true;

async function checkFirebase(): Promise<boolean> {
  try {
    // Just accessing db will throw if Firebase isn't configured
    if (!db) return false;
    return true;
  } catch {
    firebaseAvailable = false;
    return false;
  }
}

export async function processSyncQueue(
  localDb: AppDatabase,
  userId: string,
  localUserId: string
): Promise<{ synced: number; failed: number }> {
  if (!await checkFirebase()) {
    console.warn('Firebase not configured — skipping sync');
    return { synced: 0, failed: 0 };
  }

  const pending = await getPendingSyncOperations(localDb);
  let synced = 0;
  let failed = 0;

  for (const op of pending) {
    try {
      await updateSyncOperation(localDb, op.id, { status: 'syncing' });

      switch (op.entityType) {
        case 'job': {
          const job = await getJobById(localDb, op.entityId);
          if (!job) throw new Error('Job not found');

          if (op.operationType === 'delete') {
            await deleteDoc(doc(db, `users/${userId}/jobs/${op.entityId}`));
          } else {
            await setDoc(doc(db, `users/${userId}/jobs/${op.entityId}`), {
              id: job.id,
              title: job.title,
              jobType: job.jobType,
              status: job.status,
              roughNotes: job.roughNotes,
              internalNotes: job.internalNotes,
              createdAt: job.createdAt,
              updatedAt: job.updatedAt,
              ownerUid: userId,
              localId: job.id,
            });
          }
          break;
        }
        case 'note': {
          const notes = await getNotesByJobId(localDb, op.entityId);
          const note = notes.find(n => n.id === op.entityId);
          if (!note) throw new Error('Note not found');
          await setDoc(doc(db, `users/${userId}/jobs/${note.jobId}/notes/${op.entityId}`), {
            id: note.id,
            content: note.content,
            noteType: note.noteType,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
            ownerUid: userId,
            localId: note.id,
          });
          break;
        }
        case 'material': {
          const materials = await getMaterialsByJobId(localDb, op.entityId);
          const material = materials.find(m => m.id === op.entityId);
          if (!material) throw new Error('Material not found');
          await setDoc(doc(db, `users/${userId}/jobs/${material.jobId}/materials/${op.entityId}`), {
            id: material.id,
            name: material.name,
            quantity: material.quantity,
            unit: material.unit,
            unitCost: material.unitCost,
            totalCost: material.totalCost,
            billable: material.billable,
            createdAt: material.createdAt,
            updatedAt: material.updatedAt,
            ownerUid: userId,
            localId: material.id,
          });
          break;
        }
        case 'timeEntry': {
          const timeEntries = await getTimeEntriesByJobId(localDb, op.entityId);
          const timeEntry = timeEntries.find(t => t.id === op.entityId);
          if (!timeEntry) throw new Error('Time entry not found');
          await setDoc(doc(db, `users/${userId}/jobs/${timeEntry.jobId}/timeEntries/${op.entityId}`), {
            id: timeEntry.id,
            durationMinutes: timeEntry.durationMinutes,
            description: timeEntry.description,
            billable: timeEntry.billable,
            createdAt: timeEntry.createdAt,
            updatedAt: timeEntry.updatedAt,
            ownerUid: userId,
            localId: timeEntry.id,
          });
          break;
        }
      }

      await updateSyncOperation(localDb, op.id, {
        status: 'synced',
        processedAt: new Date().toISOString(),
      });
      synced++;
    } catch (error: any) {
      console.error(`Sync failed for ${op.entityType}/${op.entityId}:`, error);
      await updateSyncOperation(localDb, op.id, {
        status: 'failed',
        lastError: error.message || 'Unknown error',
        retryCount: op.retryCount + 1,
      });
      failed++;
    }
  }

  return { synced, failed };
}