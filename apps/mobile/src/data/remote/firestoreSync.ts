import { db } from './firebaseConfig';
import { collection, doc, setDoc, deleteDoc, getDocs } from 'firebase/firestore';
import type { AppDatabase } from '../local/types';
import { getPendingSyncOperations, updateSyncOperation } from '../local/syncRepository';
import { getJobById, upsertJob } from '../local/jobRepository';
import { getNotesByJobId, upsertNote } from '../local/noteRepository';
import { getMaterialsByJobId, upsertMaterial } from '../local/materialRepository';
import { getTimeEntriesByJobId, upsertTimeEntry } from '../local/timeEntryRepository';
import { getPhotoById, updatePhoto, upsertPhoto } from '../local/photoRepository';
import { getUserById, updateUser } from '../local/userRepository';
import { getClientById, upsertClient } from '../local/clientRepository';
import { getSiteById, upsertSite } from '../local/siteRepository';
import { getApprovalById, upsertApproval } from '../local/customerApprovalRepository';
import { getVoiceNoteById, upsertVoiceNote } from '../local/voiceNoteRepository';
import { uploadPhoto } from './storageService';

async function checkFirebase(): Promise<boolean> {
  try {
    if (!db) return false;
    return true;
  } catch {
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
          if (!job) {
            // Entity was soft-deleted locally — push the delete to Firestore if it's a create/update,
            // otherwise just mark it as synced
            if (op.operationType !== 'delete') {
              await deleteDoc(doc(db, `users/${userId}/jobs/${op.entityId}`));
            }
            await updateSyncOperation(localDb, op.id, { status: 'synced', processedAt: new Date().toISOString() });
            synced++;
            break;
          }

          if (op.operationType === 'delete') {
            await deleteDoc(doc(db, `users/${userId}/jobs/${op.entityId}`));
          } else {
            await setDoc(doc(db, `users/${userId}/jobs/${op.entityId}`), {
              id: job.id,
              title: job.title,
              jobType: job.jobType,
              status: job.status,
              clientId: job.clientId,
              siteId: job.siteId,
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
          if (!note) {
            // Entity was deleted locally — mark sync as completed since there's nothing to push
            await updateSyncOperation(localDb, op.id, { status: 'synced', processedAt: new Date().toISOString() });
            synced++;
            break;
          }
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
          if (!material) {
            await updateSyncOperation(localDb, op.id, { status: 'synced', processedAt: new Date().toISOString() });
            synced++;
            break;
          }
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
          if (!timeEntry) {
            await updateSyncOperation(localDb, op.id, { status: 'synced', processedAt: new Date().toISOString() });
            synced++;
            break;
          }
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
        case 'photo': {
          if (op.operationType === 'delete') {
            // Delete photo metadata from Firestore
            try {
              await deleteDoc(doc(db, `users/${userId}/photos/${op.entityId}`));
            } catch {
              // Photo may not exist in Firestore — that's fine
            }
          } else {
            // Upload photo metadata to Firestore and upload the file
            const photo = await getPhotoById(localDb, op.entityId);
            if (!photo) {
              // Entity was deleted locally — mark sync as completed
              await updateSyncOperation(localDb, op.id, { status: 'synced', processedAt: new Date().toISOString() });
              synced++;
              break;
            }

            // Upload the photo file to Firebase Storage if it hasn't been uploaded yet
            if (photo.localUri && photo.uploadStatus !== 'uploaded') {
              try {
                const remoteUrl = await uploadPhoto(photo.localUri, userId, photo.jobId, photo.id);
                if (remoteUrl) {
                  // Update local record with the remote URL and upload status
                  await updatePhoto(localDb, photo.id, {
                    remoteUrl,
                    uploadStatus: 'uploaded',
                    syncStatus: 'synced',
                  });
                }
              } catch (uploadError) {
                console.warn('Photo file upload failed, will retry:', uploadError);
                // Mark upload as failed but continue with metadata sync
                await updatePhoto(localDb, photo.id, { uploadStatus: 'failed' });
              }
            }

            // Push photo metadata to Firestore
            await setDoc(doc(db, `users/${userId}/photos/${op.entityId}`), {
              id: photo.id,
              jobId: photo.jobId,
              userId: photo.userId,
              photoType: photo.photoType,
              caption: photo.caption,
              takenAt: photo.takenAt,
              remoteUrl: photo.remoteUrl,
              uploadStatus: photo.uploadStatus,
              createdAt: photo.createdAt,
              updatedAt: photo.updatedAt,
              ownerUid: userId,
              localId: photo.id,
            });
          }
          break;
        }
        case 'client': {
          const client = await getClientById(localDb, op.entityId);
          if (!client) {
            await updateSyncOperation(localDb, op.id, { status: 'synced', processedAt: new Date().toISOString() });
            synced++;
            break;
          }
          if (op.operationType === 'delete') {
            await deleteDoc(doc(db, `users/${userId}/clients/${op.entityId}`));
          } else {
            await setDoc(doc(db, `users/${userId}/clients/${op.entityId}`), {
              id: client.id,
              name: client.name,
              phone: client.phone,
              email: client.email,
              notes: client.notes,
              createdAt: client.createdAt,
              updatedAt: client.updatedAt,
              ownerUid: userId,
              localId: client.id,
            });
          }
          break;
        }
        case 'site': {
          const site = await getSiteById(localDb, op.entityId);
          if (!site) {
            await updateSyncOperation(localDb, op.id, { status: 'synced', processedAt: new Date().toISOString() });
            synced++;
            break;
          }
          if (op.operationType === 'delete') {
            await deleteDoc(doc(db, `users/${userId}/sites/${op.entityId}`));
          } else {
            await setDoc(doc(db, `users/${userId}/sites/${op.entityId}`), {
              id: site.id,
              clientId: site.clientId,
              name: site.name,
              addressLine1: site.addressLine1,
              addressLine2: site.addressLine2,
              city: site.city,
              state: site.state,
              postalCode: site.postalCode,
              country: site.country,
              notes: site.notes,
              createdAt: site.createdAt,
              updatedAt: site.updatedAt,
              ownerUid: userId,
              localId: site.id,
            });
          }
          break;
        }
        case 'customer_approval': {
          const approval = await getApprovalById(localDb, op.entityId);
          if (!approval) {
            await updateSyncOperation(localDb, op.id, { status: 'synced', processedAt: new Date().toISOString() });
            synced++;
            break;
          }
          if (op.operationType === 'delete') {
            await deleteDoc(doc(db, `users/${userId}/jobs/${approval.jobId}/approvals/${op.entityId}`));
          } else {
            await setDoc(doc(db, `users/${userId}/jobs/${approval.jobId}/approvals/${op.entityId}`), {
              id: approval.id,
              jobId: approval.jobId,
              customerName: approval.customerName,
              signatureLocalUri: approval.signatureLocalUri,
              signatureRemoteUrl: approval.signatureRemoteUrl,
              approvedAt: approval.approvedAt,
              approvalNotes: approval.approvalNotes,
              createdAt: approval.createdAt,
              updatedAt: approval.updatedAt,
              ownerUid: userId,
              localId: approval.id,
            });
          }
          break;
        }
        case 'voice_note': {
          const voiceNote = await getVoiceNoteById(localDb, op.entityId);
          if (!voiceNote) {
            await updateSyncOperation(localDb, op.id, { status: 'synced', processedAt: new Date().toISOString() });
            synced++;
            break;
          }
          if (op.operationType === 'delete') {
            await deleteDoc(doc(db, `users/${userId}/jobs/${voiceNote.jobId}/voiceNotes/${op.entityId}`));
          } else {
            await setDoc(doc(db, `users/${userId}/jobs/${voiceNote.jobId}/voiceNotes/${op.entityId}`), {
              id: voiceNote.id,
              jobId: voiceNote.jobId,
              localAudioUri: voiceNote.localAudioUri,
              durationSeconds: voiceNote.durationSeconds,
              transcript: voiceNote.transcript,
              transcriptSource: voiceNote.transcriptSource,
              createdAt: voiceNote.createdAt,
              updatedAt: voiceNote.updatedAt,
              ownerUid: userId,
              localId: voiceNote.id,
            });
          }
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

/**
 * Pull remote changes from Firestore and merge into local SQLite.
 * Uses last-write-wins conflict resolution based on `updatedAt` timestamps.
 * Does NOT create sync operations for pulled records (avoids infinite sync loops).
 */
export async function pullFromCloud(
  localDb: AppDatabase,
  userId: string,
  localUserId: string
): Promise<{ pulled: number }> {
  if (!await checkFirebase()) {
    console.warn('Firebase not configured — skipping pull');
    return { pulled: 0 };
  }

  let pulled = 0;

  try {
    // 1. Pull jobs
    const jobsSnapshot = await getDocs(collection(db, `users/${userId}/jobs`));
    for (const jobDoc of jobsSnapshot.docs) {
      const data = jobDoc.data();
      // Skip if this was originally created on this device and hasn't been modified elsewhere
      if (data.localId && data.localId === data.id) {
        // Still upsert — it might have been updated on another device
      }

      await upsertJob(localDb, {
        id: data.id,
        userId: localUserId, // Use local user ID for scoping
        title: data.title ?? '',
        jobType: data.jobType ?? null,
        status: data.status ?? 'draft',
        priority: data.priority ?? 'normal',
        clientId: data.clientId ?? null,
        siteId: data.siteId ?? null,
        roughNotes: data.roughNotes ?? null,
        structuredSummary: data.structuredSummary ?? null,
        internalNotes: data.internalNotes ?? null,
        customerVisibleSummary: data.customerVisibleSummary ?? null,
        aiStatus: data.aiStatus ?? 'not_started',
        createdAt: data.createdAt ?? new Date().toISOString(),
        updatedAt: data.updatedAt ?? new Date().toISOString(),
        deletedAt: data.deletedAt ?? null,
      });
      pulled++;

      // 2. Pull subcollections for this job
      const jobId = data.id;

      // Notes
      try {
        const notesSnapshot = await getDocs(collection(db, `users/${userId}/jobs/${jobId}/notes`));
        for (const noteDoc of notesSnapshot.docs) {
          const noteData = noteDoc.data();
          await upsertNote(localDb, {
            id: noteData.id,
            jobId,
            userId: localUserId,
            noteType: noteData.noteType ?? 'manual',
            content: noteData.content ?? '',
            createdAt: noteData.createdAt ?? new Date().toISOString(),
            updatedAt: noteData.updatedAt ?? new Date().toISOString(),
            deletedAt: noteData.deletedAt ?? null,
          });
          pulled++;
        }
      } catch (e) {
        console.warn(`Failed to pull notes for job ${jobId}:`, e);
      }

      // Materials
      try {
        const materialsSnapshot = await getDocs(collection(db, `users/${userId}/jobs/${jobId}/materials`));
        for (const matDoc of materialsSnapshot.docs) {
          const matData = matDoc.data();
          await upsertMaterial(localDb, {
            id: matData.id,
            jobId,
            userId: localUserId,
            name: matData.name ?? '',
            quantity: matData.quantity ?? 1,
            unit: matData.unit ?? null,
            unitCost: matData.unitCost ?? null,
            totalCost: matData.totalCost ?? null,
            billable: matData.billable !== false,
            createdAt: matData.createdAt ?? new Date().toISOString(),
            updatedAt: matData.updatedAt ?? new Date().toISOString(),
            deletedAt: matData.deletedAt ?? null,
          });
          pulled++;
        }
      } catch (e) {
        console.warn(`Failed to pull materials for job ${jobId}:`, e);
      }

      // Time entries
      try {
        const timeSnapshot = await getDocs(collection(db, `users/${userId}/jobs/${jobId}/timeEntries`));
        for (const timeDoc of timeSnapshot.docs) {
          const timeData = timeDoc.data();
          await upsertTimeEntry(localDb, {
            id: timeData.id,
            jobId,
            userId: localUserId,
            startedAt: timeData.startedAt ?? null,
            endedAt: timeData.endedAt ?? null,
            durationMinutes: timeData.durationMinutes ?? null,
            description: timeData.description ?? null,
            billable: timeData.billable !== false,
            createdAt: timeData.createdAt ?? new Date().toISOString(),
            updatedAt: timeData.updatedAt ?? new Date().toISOString(),
            deletedAt: timeData.deletedAt ?? null,
          });
          pulled++;
        }
      } catch (e) {
        console.warn(`Failed to pull time entries for job ${jobId}:`, e);
      }
    }

    // 3. Pull photos (top-level collection)
    try {
      const photosSnapshot = await getDocs(collection(db, `users/${userId}/photos`));
      for (const photoDoc of photosSnapshot.docs) {
        const photoData = photoDoc.data();
        await upsertPhoto(localDb, {
          id: photoData.id,
          jobId: photoData.jobId ?? '',
          userId: localUserId,
          localUri: photoData.localUri ?? '', // Local URI won't exist on remote — keep whatever we have
          remoteUrl: photoData.remoteUrl ?? null,
          photoType: photoData.photoType ?? 'general',
          caption: photoData.caption ?? null,
          takenAt: photoData.takenAt ?? null,
          uploadStatus: photoData.uploadStatus ?? 'uploaded', // If it's in Firestore, it's uploaded
          createdAt: photoData.createdAt ?? new Date().toISOString(),
          updatedAt: photoData.updatedAt ?? new Date().toISOString(),
          deletedAt: photoData.deletedAt ?? null,
        });
        pulled++;
      }
    } catch (e) {
      console.warn('Failed to pull photos:', e);
    }

    // 4. Pull clients (top-level collection)
    try {
      const clientsSnapshot = await getDocs(collection(db, `users/${userId}/clients`));
      for (const clientDoc of clientsSnapshot.docs) {
        const clientData = clientDoc.data();
        await upsertClient(localDb, {
          id: clientData.id,
          userId: localUserId,
          name: clientData.name ?? '',
          phone: clientData.phone ?? null,
          email: clientData.email ?? null,
          notes: clientData.notes ?? null,
          createdAt: clientData.createdAt ?? new Date().toISOString(),
          updatedAt: clientData.updatedAt ?? new Date().toISOString(),
          deletedAt: clientData.deletedAt ?? null,
        });
        pulled++;
      }
    } catch (e) {
      console.warn('Failed to pull clients:', e);
    }

    // 5. Pull sites (top-level collection)
    try {
      const sitesSnapshot = await getDocs(collection(db, `users/${userId}/sites`));
      for (const siteDoc of sitesSnapshot.docs) {
        const siteData = siteDoc.data();
        await upsertSite(localDb, {
          id: siteData.id,
          userId: localUserId,
          clientId: siteData.clientId ?? null,
          name: siteData.name ?? null,
          addressLine1: siteData.addressLine1 ?? null,
          addressLine2: siteData.addressLine2 ?? null,
          city: siteData.city ?? null,
          state: siteData.state ?? null,
          postalCode: siteData.postalCode ?? null,
          country: siteData.country ?? null,
          notes: siteData.notes ?? null,
          createdAt: siteData.createdAt ?? new Date().toISOString(),
          updatedAt: siteData.updatedAt ?? new Date().toISOString(),
          deletedAt: siteData.deletedAt ?? null,
        });
        pulled++;
      }
    } catch (e) {
      console.warn('Failed to pull sites:', e);
    }

    // 6. Pull customer approvals (subcollection under jobs)
    try {
      const jobsSnapshot = await getDocs(collection(db, `users/${userId}/jobs`));
      for (const jobDoc of jobsSnapshot.docs) {
        try {
          const approvalsSnapshot = await getDocs(collection(db, `users/${userId}/jobs/${jobDoc.id}/approvals`));
          for (const approvalDoc of approvalsSnapshot.docs) {
            const approvalData = approvalDoc.data();
            await upsertApproval(localDb, {
              id: approvalData.id,
              jobId: approvalData.jobId ?? jobDoc.id,
              userId: localUserId,
              customerName: approvalData.customerName ?? null,
              signatureLocalUri: approvalData.signatureLocalUri ?? null,
              signatureRemoteUrl: approvalData.signatureRemoteUrl ?? null,
              approvedAt: approvalData.approvedAt ?? null,
              approvalNotes: approvalData.approvalNotes ?? null,
              createdAt: approvalData.createdAt ?? new Date().toISOString(),
              updatedAt: approvalData.updatedAt ?? new Date().toISOString(),
              deletedAt: approvalData.deletedAt ?? null,
            });
            pulled++;
          }
        } catch (e) {
          console.warn(`Failed to pull approvals for job ${jobDoc.id}:`, e);
        }
      }
    } catch (e) {
      console.warn('Failed to pull customer approvals:', e);
    }

    // 7. Pull voice notes (subcollection under jobs)
    try {
      const jobsSnapshot = await getDocs(collection(db, `users/${userId}/jobs`));
      for (const jobDoc of jobsSnapshot.docs) {
        try {
          const voiceNotesSnapshot = await getDocs(collection(db, `users/${userId}/jobs/${jobDoc.id}/voiceNotes`));
          for (const vnDoc of voiceNotesSnapshot.docs) {
            const vnData = vnDoc.data();
            await upsertVoiceNote(localDb, {
              id: vnData.id,
              jobId: vnData.jobId ?? jobDoc.id,
              userId: localUserId,
              localAudioUri: vnData.localAudioUri ?? null,
              durationSeconds: vnData.durationSeconds ?? null,
              transcript: vnData.transcript ?? null,
              transcriptSource: vnData.transcriptSource ?? null,
              createdAt: vnData.createdAt ?? new Date().toISOString(),
              updatedAt: vnData.updatedAt ?? new Date().toISOString(),
              deletedAt: vnData.deletedAt ?? null,
            });
            pulled++;
          }
        } catch (e) {
          console.warn(`Failed to pull voice notes for job ${jobDoc.id}:`, e);
        }
      }
    } catch (e) {
      console.warn('Failed to pull voice notes:', e);
    }

    // 8. Update lastSyncedAt on the local user record
    const localUser = await getUserById(localDb, localUserId);
    if (localUser) {
      await updateUser(localDb, localUserId, { lastSyncedAt: new Date().toISOString() });
    }

    console.log(`Pull complete: ${pulled} records pulled from cloud`);
  } catch (error) {
    console.error('Pull from cloud failed:', error);
  }

  return { pulled };
}