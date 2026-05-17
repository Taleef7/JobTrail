// Mock uuid before any imports — Jest hoists this to the top
jest.mock('uuid', () => {
  let counter = 0;
  return { v4: () => `mock-uuid-${++counter}` };
});

/* eslint-disable import/first */
import { MockSQLiteDatabase } from '../src/data/local/MockDatabase';
import type { AppDatabase } from '../src/data/local/types';
import {
  createJob,
  getJobById,
  getAllJobs,
  updateJob,
  deleteJob,
  upsertJob,
} from '../src/data/local/jobRepository';
import {
  createNote,
  getNotesByJobId,
  getNoteById,
  updateNote,
  deleteNote,
  upsertNote,
} from '../src/data/local/noteRepository';
import {
  createMaterial,
  getMaterialsByJobId,
  getMaterialById,
  deleteMaterial,
  upsertMaterial,
  updateMaterial,
} from '../src/data/local/materialRepository';
import {
  createTimeEntry,
  getTimeEntriesByJobId,
  getTimeEntryById,
  deleteTimeEntry,
  upsertTimeEntry,
  updateTimeEntry,
} from '../src/data/local/timeEntryRepository';
import {
  createClient,
  getAllClients,
  getClientById,
  updateClient,
  deleteClient,
  upsertClient,
} from '../src/data/local/clientRepository';
import {
  createSite,
  getAllSites,
  getSitesByClientId,
  getSiteById,
  updateSite,
  deleteSite,
  upsertSite,
} from '../src/data/local/siteRepository';
/* eslint-enable import/first */

// ────────────────────────────────── Test Setup ──────────────────────────────────

async function setupTestDb(): Promise<AppDatabase> {
  const db = new MockSQLiteDatabase();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      title TEXT NOT NULL,
      jobType TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      priority TEXT DEFAULT 'normal',
      clientId TEXT,
      siteId TEXT,
      roughNotes TEXT,
      structuredSummary TEXT,
      internalNotes TEXT,
      customerVisibleSummary TEXT,
      aiStatus TEXT DEFAULT 'not_started',
      syncStatus TEXT NOT NULL DEFAULT 'local_only',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS job_notes (
      id TEXT PRIMARY KEY,
      jobId TEXT NOT NULL,
      userId TEXT NOT NULL,
      noteType TEXT NOT NULL DEFAULT 'manual',
      content TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT,
      syncStatus TEXT NOT NULL DEFAULT 'local_only'
    );

    CREATE TABLE IF NOT EXISTS material_line_items (
      id TEXT PRIMARY KEY,
      jobId TEXT NOT NULL,
      userId TEXT NOT NULL,
      name TEXT NOT NULL,
      quantity REAL DEFAULT 1,
      unit TEXT,
      unitCost REAL,
      totalCost REAL,
      billable INTEGER DEFAULT 1,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT,
      syncStatus TEXT NOT NULL DEFAULT 'local_only'
    );

    CREATE TABLE IF NOT EXISTS time_entries (
      id TEXT PRIMARY KEY,
      jobId TEXT NOT NULL,
      userId TEXT NOT NULL,
      startedAt TEXT,
      endedAt TEXT,
      durationMinutes INTEGER,
      description TEXT,
      billable INTEGER DEFAULT 1,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT,
      syncStatus TEXT NOT NULL DEFAULT 'local_only'
    );

    CREATE TABLE IF NOT EXISTS ai_extraction_results (
      id TEXT PRIMARY KEY,
      jobId TEXT NOT NULL,
      userId TEXT NOT NULL,
      sourceType TEXT NOT NULL,
      sourceId TEXT,
      provider TEXT NOT NULL,
      modelName TEXT,
      inputText TEXT NOT NULL,
      extractedJson TEXT NOT NULL,
      confidence REAL,
      createdAt TEXT NOT NULL,
      acceptedAt TEXT,
      rejectedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      cloudUid TEXT NOT NULL,
      email TEXT NOT NULL,
      displayName TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      lastSyncedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS photo_assets (
      id TEXT PRIMARY KEY,
      jobId TEXT NOT NULL,
      userId TEXT NOT NULL,
      localUri TEXT NOT NULL,
      remoteUrl TEXT,
      photoType TEXT NOT NULL DEFAULT 'general',
      caption TEXT,
      takenAt TEXT,
      uploadStatus TEXT NOT NULL DEFAULT 'pending',
      syncStatus TEXT NOT NULL DEFAULT 'local_only',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_operations (
      id TEXT PRIMARY KEY,
      entityType TEXT NOT NULL,
      entityId TEXT NOT NULL,
      operationType TEXT NOT NULL,
      payloadJson TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      retryCount INTEGER NOT NULL DEFAULT 0,
      lastError TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      processedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      notes TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT,
      syncStatus TEXT NOT NULL DEFAULT 'local_only'
    );

    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      clientId TEXT,
      name TEXT,
      addressLine1 TEXT,
      addressLine2 TEXT,
      city TEXT,
      state TEXT,
      postalCode TEXT,
      country TEXT,
      notes TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT,
      syncStatus TEXT NOT NULL DEFAULT 'local_only'
    );
  `);
  return db;
}

let db: AppDatabase;

beforeEach(async () => {
  db = await setupTestDb();
});

// ────────────────────────────────── Utility ──────────────────────────────────

/** Helper: pause briefly so that consecutive `now()` calls differ. */
function later(ms = 5): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ────────────────────────────────── Job Repository ──────────────────────────────────

describe('jobRepository', () => {
  it('creates a job and returns it with correct fields', async () => {
    const job = await createJob(db, {
      title: 'Kitchen Sink Repair',
      jobType: 'plumbing',
      priority: 'high',
      roughNotes: 'Leaky pipe under sink',
    });

    expect(job).toBeDefined();
    expect(job.id).toMatch(/^mock-uuid-/);
    expect(job.title).toBe('Kitchen Sink Repair');
    expect(job.jobType).toBe('plumbing');
    expect(job.status).toBe('draft');
    expect(job.priority).toBe('high');
    expect(job.roughNotes).toBe('Leaky pipe under sink');
    expect(job.clientId).toBeNull();
    expect(job.siteId).toBeNull();
    expect(job.structuredSummary).toBeNull();
    expect(job.internalNotes).toBeNull();
    expect(job.customerVisibleSummary).toBeNull();
    expect(job.aiStatus).toBe('not_started');
    expect(job.syncStatus).toBe('local_only');
    expect(job.createdAt).toBeDefined();
    expect(job.updatedAt).toBe(job.createdAt);
    expect(job.userId).toBe('local_user');
  });

  it('getJobById retrieves a created job', async () => {
    const created = await createJob(db, { title: 'Test Job' });
    const found = await getJobById(db, created.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(created.id);
    expect(found!.title).toBe('Test Job');
  });

  it('getJobById returns null for non-existent id', async () => {
    const result = await getJobById(db, 'non-existent-id');
    expect(result).toBeNull();
  });

  it('getJobById returns null for a soft-deleted job', async () => {
    const job = await createJob(db, { title: 'To Delete' });
    await deleteJob(db, job.id);
    const found = await getJobById(db, job.id);
    expect(found).toBeNull();
  });

  it('getAllJobs returns only non-deleted jobs', async () => {
    await createJob(db, { title: 'Job One' });
    const job2 = await createJob(db, { title: 'Job Two' });
    await createJob(db, { title: 'Job Three' });

    // Delete job2
    await deleteJob(db, job2.id);

    const jobs = await getAllJobs(db);
    expect(jobs).toHaveLength(2);
    const titles = jobs.map((j) => j.title).sort();
    expect(titles).toEqual(['Job One', 'Job Three']);
  });

  it('getAllJobs returns empty array when no jobs exist', async () => {
    const jobs = await getAllJobs(db);
    expect(jobs).toEqual([]);
  });

  it('updateJob modifies specified fields', async () => {
    const job = await createJob(db, {
      title: 'Original Title',
      jobType: 'original-type',
      priority: 'low',
    });

    await later();
    const updated = await updateJob(db, job.id, {
      title: 'Updated Title',
      priority: 'high',
    });

    expect(updated).toBeDefined();
    expect(updated!.title).toBe('Updated Title');
    expect(updated!.priority).toBe('high');
    // Fields not in updates should remain unchanged
    expect(updated!.jobType).toBe('original-type');
    expect(updated!.status).toBe('draft');
  });

  it('updateJob returns null for non-existent id', async () => {
    const result = await updateJob(db, 'non-existent', { title: 'Nope' });
    expect(result).toBeNull();
  });

  it('deleteJob soft-deletes and returns true', async () => {
    const job = await createJob(db, { title: 'Delete Me' });
    const result = await deleteJob(db, job.id);
    expect(result).toBe(true);

    // Should not appear in getAll
    const jobs = await getAllJobs(db);
    expect(jobs.find((j) => j.id === job.id)).toBeUndefined();

    // But the row still exists in the database with deletedAt set
    const raw = await (db as MockSQLiteDatabase).getFirstAsync<{ deletedAt: string }>(
      'SELECT deletedAt FROM jobs WHERE id = ?',
      [job.id]
    );
    expect(raw).toBeDefined();
    expect(raw!.deletedAt).toBeDefined();
  });

  it('deleteJob returns false for non-existent id', async () => {
    const result = await deleteJob(db, 'non-existent');
    expect(result).toBe(false);
  });

  it('upsertJob inserts a new record when id does not exist', async () => {
    const id = 'upsert-new-id';
    const now = new Date().toISOString();
    await upsertJob(db, {
      id,
      userId: 'user1',
      title: 'Upserted New',
      jobType: null,
      status: 'draft',
      priority: 'normal',
      clientId: null,
      siteId: null,
      roughNotes: null,
      structuredSummary: null,
      internalNotes: null,
      customerVisibleSummary: null,
      aiStatus: 'not_started',
      createdAt: now,
      updatedAt: now,
    });

    const found = await getJobById(db, id);
    expect(found).toBeDefined();
    expect(found!.title).toBe('Upserted New');
    expect(found!.syncStatus).toBe('synced');
  });

  it('upsertJob updates an existing record when remote is newer', async () => {
    // First create a job via normal create
    const job = await createJob(db, { title: 'Original' });

    await later();
    const newUpdatedAt = new Date().toISOString();

    // Upsert with newer updatedAt
    await upsertJob(db, {
      id: job.id,
      userId: 'local_user',
      title: 'Updated via Upsert',
      jobType: null,
      status: 'in_progress',
      priority: 'high',
      clientId: null,
      siteId: null,
      roughNotes: null,
      structuredSummary: null,
      internalNotes: null,
      customerVisibleSummary: null,
      aiStatus: 'not_started',
      createdAt: job.createdAt,
      updatedAt: newUpdatedAt,
    });

    const found = await getJobById(db, job.id);
    expect(found).toBeDefined();
    expect(found!.title).toBe('Updated via Upsert');
    expect(found!.status).toBe('in_progress');
    expect(found!.priority).toBe('high');
  });

  it('upsertJob does NOT update when remote is older (last-write-wins)', async () => {
    const job = await createJob(db, { title: 'Keep Me' });
    const oldDate = '2020-01-01T00:00:00.000Z';

    // Attempt to upsert with an older timestamp
    await upsertJob(db, {
      id: job.id,
      userId: 'local_user',
      title: 'Should Not Apply',
      jobType: null,
      status: 'draft',
      priority: 'normal',
      clientId: null,
      siteId: null,
      roughNotes: null,
      structuredSummary: null,
      internalNotes: null,
      customerVisibleSummary: null,
      aiStatus: 'not_started',
      createdAt: job.createdAt,
      updatedAt: oldDate,
    });

    const found = await getJobById(db, job.id);
    expect(found).toBeDefined();
    expect(found!.title).toBe('Keep Me');
  });
});

// ────────────────────────────────── Note Repository ──────────────────────────────────

describe('noteRepository', () => {
  let jobId: string;

  beforeEach(async () => {
    const job = await createJob(db, { title: 'Job for Notes' });
    jobId = job.id;
  });

  it('creates a note and returns it with correct fields', async () => {
    const note = await createNote(db, jobId, {
      content: 'Fixed the leaky pipe',
      noteType: 'manual',
    });

    expect(note).toBeDefined();
    expect(note.id).toMatch(/^mock-uuid-/);
    expect(note.jobId).toBe(jobId);
    expect(note.content).toBe('Fixed the leaky pipe');
    expect(note.noteType).toBe('manual');
    expect(note.syncStatus).toBe('local_only');
    expect(note.createdAt).toBeDefined();
    expect(note.updatedAt).toBe(note.createdAt);
    expect(note.userId).toBe('local_user');
  });

  it('getNoteById retrieves a created note', async () => {
    const created = await createNote(db, jobId, { content: 'Test note' });
    const found = await getNoteById(db, created.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(created.id);
    expect(found!.content).toBe('Test note');
  });

  it('getNoteById returns null for non-existent id', async () => {
    const result = await getNoteById(db, 'non-existent');
    expect(result).toBeNull();
  });

  it('getNotesByJobId returns notes for the correct job only', async () => {
    const job2 = await createJob(db, { title: 'Second Job' });

    const note1 = await createNote(db, jobId, { content: 'Note for Job 1' });
    const note2 = await createNote(db, jobId, { content: 'Another note for Job 1' });
    await createNote(db, job2.id, { content: 'Note for Job 2' });

    const notes = await getNotesByJobId(db, jobId);
    expect(notes).toHaveLength(2);
    expect(notes.map((n) => n.id)).toEqual([note1.id, note2.id]);
  });

  it('getNotesByJobId returns empty array when no notes exist', async () => {
    const notes = await getNotesByJobId(db, jobId);
    expect(notes).toEqual([]);
  });

  it('updateNote modifies content', async () => {
    const note = await createNote(db, jobId, { content: 'Old content' });
    await later();
    const updated = await updateNote(db, note.id, { content: 'New content' });

    expect(updated).toBeDefined();
    expect(updated!.content).toBe('New content');
    expect(updated!.noteType).toBe('manual'); // unchanged
  });

  it('updateNote returns null for non-existent id', async () => {
    const result = await updateNote(db, 'non-existent', { content: 'Nope' });
    expect(result).toBeNull();
  });

  it('deleteNote soft-deletes', async () => {
    const note = await createNote(db, jobId, { content: 'Delete me' });
    const result = await deleteNote(db, note.id);
    expect(result).toBe(true);

    const found = await getNoteById(db, note.id);
    expect(found).toBeNull();

    const notes = await getNotesByJobId(db, jobId);
    expect(notes).toHaveLength(0);
  });

  it('deleteNote returns false for non-existent id', async () => {
    const result = await deleteNote(db, 'non-existent');
    expect(result).toBe(false);
  });

  it('upsertNote inserts a new record', async () => {
    const id = 'upsert-note-id';
    const now = new Date().toISOString();
    await upsertNote(db, {
      id,
      jobId,
      userId: 'user1',
      noteType: 'manual',
      content: 'Upserted note',
      createdAt: now,
      updatedAt: now,
    });

    const found = await getNoteById(db, id);
    expect(found).toBeDefined();
    expect(found!.content).toBe('Upserted note');
    expect(found!.syncStatus).toBe('synced');
  });

  it('upsertNote updates when remote is newer', async () => {
    const note = await createNote(db, jobId, { content: 'Old' });
    await later();
    const newDate = new Date().toISOString();
    await upsertNote(db, {
      id: note.id,
      jobId,
      userId: 'local_user',
      noteType: 'voice',
      content: 'Updated via upsert',
      createdAt: note.createdAt,
      updatedAt: newDate,
    });

    const found = await getNoteById(db, note.id);
    expect(found).toBeDefined();
    expect(found!.content).toBe('Updated via upsert');
    expect(found!.noteType).toBe('voice');
  });

  it('upsertNote does NOT update when remote is older', async () => {
    const note = await createNote(db, jobId, { content: 'Keep' });
    await upsertNote(db, {
      id: note.id,
      jobId,
      userId: 'local_user',
      noteType: 'manual',
      content: 'Should not replace',
      createdAt: note.createdAt,
      updatedAt: '2020-01-01T00:00:00.000Z',
    });

    const found = await getNoteById(db, note.id);
    expect(found).toBeDefined();
    expect(found!.content).toBe('Keep');
  });
});

// ────────────────────────────────── Material Repository ──────────────────────────────────

describe('materialRepository', () => {
  let jobId: string;

  beforeEach(async () => {
    const job = await createJob(db, { title: 'Job for Materials' });
    jobId = job.id;
  });

  it('creates a material and returns it with correct fields', async () => {
    const mat = await createMaterial(db, jobId, {
      name: 'PVC Pipe',
      quantity: 3,
      unit: 'ft',
      unitCost: 5.5,
    });

    expect(mat).toBeDefined();
    expect(mat.id).toMatch(/^mock-uuid-/);
    expect(mat.jobId).toBe(jobId);
    expect(mat.name).toBe('PVC Pipe');
    expect(mat.quantity).toBe(3);
    expect(mat.unit).toBe('ft');
    expect(mat.unitCost).toBe(5.5);
    expect(mat.totalCost).toBe(16.5); // 3 * 5.5
    expect(mat.billable).toBe(true);
    expect(mat.syncStatus).toBe('local_only');
  });

  it('getMaterialById retrieves created material', async () => {
    const created = await createMaterial(db, jobId, { name: 'Pipe' });
    const found = await getMaterialById(db, created.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(created.id);
    expect(found!.name).toBe('Pipe');
  });

  it('getMaterialById returns null for non-existent id', async () => {
    const result = await getMaterialById(db, 'non-existent');
    expect(result).toBeNull();
  });

  it('getMaterialsByJobId returns materials for the correct job', async () => {
    const job2 = await createJob(db, { title: 'Second Job' });

    const m1 = await createMaterial(db, jobId, { name: 'Mat A', quantity: 1 });
    const m2 = await createMaterial(db, jobId, { name: 'Mat B', quantity: 2 });
    await createMaterial(db, job2.id, { name: 'Mat Other', quantity: 1 });

    const materials = await getMaterialsByJobId(db, jobId);
    expect(materials).toHaveLength(2);
    expect(materials.map((m) => m.id)).toEqual([m1.id, m2.id]);
  });

  it('updateMaterial modifies fields', async () => {
    const mat = await createMaterial(db, jobId, { name: 'Pipe', quantity: 1, unitCost: 10 });
    const originalTotal = mat.totalCost;
    await later();
    const updated = await updateMaterial(db, mat.id, { name: 'Updated Pipe', quantity: 5, unitCost: 8 });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe('Updated Pipe');
    expect(updated!.quantity).toBe(5);
    expect(updated!.unitCost).toBe(8);
    // totalCost is not auto-recalculated by updateMaterial -> it uses the passed value or falls through
    // Since we didn't pass totalCost in the update, it retains the original value
    expect(updated!.totalCost).toBe(originalTotal);
  });

  it('updateMaterial returns null for non-existent id', async () => {
    const result = await updateMaterial(db, 'non-existent', { name: 'Nope' });
    expect(result).toBeNull();
  });

  it('deleteMaterial soft-deletes', async () => {
    const mat = await createMaterial(db, jobId, { name: 'Delete me' });
    const result = await deleteMaterial(db, mat.id);
    expect(result).toBe(true);

    const found = await getMaterialById(db, mat.id);
    expect(found).toBeNull();

    const materials = await getMaterialsByJobId(db, jobId);
    expect(materials).toHaveLength(0);
  });

  it('deleteMaterial returns false for non-existent id', async () => {
    const result = await deleteMaterial(db, 'non-existent');
    expect(result).toBe(false);
  });

  it('upsertMaterial inserts a new record', async () => {
    const id = 'upsert-mat-id';
    const now = new Date().toISOString();
    await upsertMaterial(db, {
      id,
      jobId,
      userId: 'user1',
      name: 'Upserted Material',
      quantity: 2,
      unit: null,
      unitCost: null,
      totalCost: null,
      billable: true,
      createdAt: now,
      updatedAt: now,
    });

    const found = await getMaterialById(db, id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Upserted Material');
  });

  it('upsertMaterial updates when remote is newer', async () => {
    const mat = await createMaterial(db, jobId, { name: 'Old', quantity: 1 });
    await later();
    const newDate = new Date().toISOString();
    await upsertMaterial(db, {
      id: mat.id,
      jobId,
      userId: 'local_user',
      name: 'Updated Material',
      quantity: 10,
      unit: null,
      unitCost: null,
      totalCost: null,
      billable: false,
      createdAt: mat.createdAt,
      updatedAt: newDate,
    });

    const found = await getMaterialById(db, mat.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Updated Material');
    expect(found!.quantity).toBe(10);
    expect(found!.billable).toBeFalsy();
  });

  it('upsertMaterial does NOT update when remote is older', async () => {
    const mat = await createMaterial(db, jobId, { name: 'Keep', quantity: 1 });
    await upsertMaterial(db, {
      id: mat.id,
      jobId,
      userId: 'local_user',
      name: 'Should not apply',
      quantity: 99,
      unit: null,
      unitCost: null,
      totalCost: null,
      billable: true,
      createdAt: mat.createdAt,
      updatedAt: '2020-01-01T00:00:00.000Z',
    });

    const found = await getMaterialById(db, mat.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Keep');
    expect(found!.quantity).toBe(1);
  });
});

// ────────────────────────────────── Time Entry Repository ──────────────────────────────────

describe('timeEntryRepository', () => {
  let jobId: string;

  beforeEach(async () => {
    const job = await createJob(db, { title: 'Job for Time Entries' });
    jobId = job.id;
  });

  it('creates a time entry and returns correct fields', async () => {
    const entry = await createTimeEntry(db, jobId, { durationMinutes: 60, description: 'Worked on sink' });

    expect(entry).toBeDefined();
    expect(entry.id).toMatch(/^mock-uuid-/);
    expect(entry.jobId).toBe(jobId);
    expect(entry.durationMinutes).toBe(60);
    expect(entry.description).toBe('Worked on sink');
    expect(entry.billable).toBe(true);
    expect(entry.syncStatus).toBe('local_only');
    expect(entry.startedAt).toBeNull();
    expect(entry.endedAt).toBeNull();
  });

  it('getTimeEntryById retrieves created entry', async () => {
    const created = await createTimeEntry(db, jobId, { durationMinutes: 30 });
    const found = await getTimeEntryById(db, created.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(created.id);
    expect(found!.durationMinutes).toBe(30);
  });

  it('getTimeEntryById returns null for non-existent id', async () => {
    const result = await getTimeEntryById(db, 'non-existent');
    expect(result).toBeNull();
  });

  it('getTimeEntriesByJobId returns entries for the correct job', async () => {
    const job2 = await createJob(db, { title: 'Second Job' });

    const e1 = await createTimeEntry(db, jobId, { durationMinutes: 15 });
    const e2 = await createTimeEntry(db, jobId, { durationMinutes: 30 });
    await createTimeEntry(db, job2.id, { durationMinutes: 45 });

    const entries = await getTimeEntriesByJobId(db, jobId);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.id)).toEqual([e1.id, e2.id]);
  });

  it('updateTimeEntry modifies fields', async () => {
    const entry = await createTimeEntry(db, jobId, { durationMinutes: 30, description: 'Old desc' });
    await later();
    const updated = await updateTimeEntry(db, entry.id, { durationMinutes: 45, description: 'New desc' });

    expect(updated).toBeDefined();
    expect(updated!.durationMinutes).toBe(45);
    expect(updated!.description).toBe('New desc');
    expect(updated!.billable).toBeTruthy(); // unchanged
  });

  it('updateTimeEntry returns null for non-existent id', async () => {
    const result = await updateTimeEntry(db, 'non-existent', { durationMinutes: 10 });
    expect(result).toBeNull();
  });

  it('deleteTimeEntry soft-deletes', async () => {
    const entry = await createTimeEntry(db, jobId, { durationMinutes: 10 });
    const result = await deleteTimeEntry(db, entry.id);
    expect(result).toBe(true);

    const found = await getTimeEntryById(db, entry.id);
    expect(found).toBeNull();

    const entries = await getTimeEntriesByJobId(db, jobId);
    expect(entries).toHaveLength(0);
  });

  it('deleteTimeEntry returns false for non-existent id', async () => {
    const result = await deleteTimeEntry(db, 'non-existent');
    expect(result).toBe(false);
  });

  it('upsertTimeEntry inserts a new record', async () => {
    const id = 'upsert-te-id';
    const now = new Date().toISOString();
    await upsertTimeEntry(db, {
      id,
      jobId,
      userId: 'user1',
      startedAt: null,
      endedAt: null,
      durationMinutes: 60,
      description: 'Upserted entry',
      billable: true,
      createdAt: now,
      updatedAt: now,
    });

    const found = await getTimeEntryById(db, id);
    expect(found).toBeDefined();
    expect(found!.durationMinutes).toBe(60);
  });

  it('upsertTimeEntry updates when remote is newer', async () => {
    const entry = await createTimeEntry(db, jobId, { durationMinutes: 10 });
    await later();
    const newDate = new Date().toISOString();
    await upsertTimeEntry(db, {
      id: entry.id,
      jobId,
      userId: 'local_user',
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      durationMinutes: 999,
      description: 'Updated',
      billable: false,
      createdAt: entry.createdAt,
      updatedAt: newDate,
    });

    const found = await getTimeEntryById(db, entry.id);
    expect(found).toBeDefined();
    expect(found!.durationMinutes).toBe(999);
    expect(found!.description).toBe('Updated');
    expect(found!.billable).toBeFalsy();
  });

  it('upsertTimeEntry does NOT update when remote is older', async () => {
    const entry = await createTimeEntry(db, jobId, { durationMinutes: 10, description: 'Keep' });
    await upsertTimeEntry(db, {
      id: entry.id,
      jobId,
      userId: 'local_user',
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      durationMinutes: 999,
      description: 'Should not apply',
      billable: true,
      createdAt: entry.createdAt,
      updatedAt: '2020-01-01T00:00:00.000Z',
    });

    const found = await getTimeEntryById(db, entry.id);
    expect(found).toBeDefined();
    expect(found!.durationMinutes).toBe(10);
    expect(found!.description).toBe('Keep');
  });
});

// ────────────────────────────────── Client Repository ──────────────────────────────────

describe('clientRepository', () => {
  it('creates a client with correct fields', async () => {
    const client = await createClient(db, {
      name: 'John Doe',
      phone: '555-0100',
      email: 'john@example.com',
      notes: 'Regular customer',
    });

    expect(client).toBeDefined();
    expect(client.id).toMatch(/^mock-uuid-/);
    expect(client.name).toBe('John Doe');
    expect(client.phone).toBe('555-0100');
    expect(client.email).toBe('john@example.com');
    expect(client.notes).toBe('Regular customer');
    expect(client.syncStatus).toBe('local_only');
    expect(client.deletedAt).toBeNull();
    expect(client.createdAt).toBeDefined();
    expect(client.updatedAt).toBe(client.createdAt);
  });

  it('getClientById retrieves a created client', async () => {
    const created = await createClient(db, { name: 'Jane Doe' });
    const found = await getClientById(db, created.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(created.id);
    expect(found!.name).toBe('Jane Doe');
  });

  it('getClientById returns null for non-existent id', async () => {
    const result = await getClientById(db, 'non-existent');
    expect(result).toBeNull();
  });

  it('getAllClients returns clients sorted by name', async () => {
    await createClient(db, { name: 'Zoe' });
    await createClient(db, { name: 'Alice' });
    await createClient(db, { name: 'Bob' });

    const clients = await getAllClients(db);
    expect(clients).toHaveLength(3);
    expect(clients[0].name).toBe('Alice');
    expect(clients[1].name).toBe('Bob');
    expect(clients[2].name).toBe('Zoe');
  });

  it('getAllClients excludes soft-deleted clients', async () => {
    const c1 = await createClient(db, { name: 'Keep' });
    const c2 = await createClient(db, { name: 'Delete' });
    await deleteClient(db, c2.id);

    const clients = await getAllClients(db);
    expect(clients).toHaveLength(1);
    expect(clients[0].id).toBe(c1.id);
  });

  it('updateClient modifies fields', async () => {
    const client = await createClient(db, { name: 'Old Name', phone: '111' });
    await later();
    const updated = await updateClient(db, client.id, { name: 'New Name', email: 'new@email.com' });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe('New Name');
    expect(updated!.email).toBe('new@email.com');
    expect(updated!.phone).toBe('111'); // unchanged
  });

  it('updateClient returns null for non-existent id', async () => {
    const result = await updateClient(db, 'non-existent', { name: 'Nope' });
    expect(result).toBeNull();
  });

  it('deleteClient soft-deletes and returns true', async () => {
    const client = await createClient(db, { name: 'Delete Me' });
    const result = await deleteClient(db, client.id);
    expect(result).toBe(true);

    const found = await getClientById(db, client.id);
    expect(found).toBeNull();
  });

  it('deleteClient returns false for non-existent id', async () => {
    const result = await deleteClient(db, 'non-existent');
    expect(result).toBe(false);
  });

  it('upsertClient inserts a new record', async () => {
    const id = 'upsert-client-id';
    const now = new Date().toISOString();
    await upsertClient(db, {
      id,
      userId: 'user1',
      name: 'Upserted Client',
      phone: null,
      email: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
    });

    const found = await getClientById(db, id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Upserted Client');
    expect(found!.syncStatus).toBe('synced');
  });

  it('upsertClient updates when remote is newer', async () => {
    const client = await createClient(db, { name: 'Old Client' });
    await later();
    const newDate = new Date().toISOString();
    await upsertClient(db, {
      id: client.id,
      userId: 'local_user',
      name: 'Updated Client',
      phone: '555-9999',
      email: null,
      notes: null,
      createdAt: client.createdAt,
      updatedAt: newDate,
    });

    const found = await getClientById(db, client.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Updated Client');
    expect(found!.phone).toBe('555-9999');
  });

  it('upsertClient does NOT update when remote is older', async () => {
    const client = await createClient(db, { name: 'Keep Me' });
    await upsertClient(db, {
      id: client.id,
      userId: 'local_user',
      name: 'Should Not Apply',
      phone: null,
      email: null,
      notes: null,
      createdAt: client.createdAt,
      updatedAt: '2020-01-01T00:00:00.000Z',
    });

    const found = await getClientById(db, client.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Keep Me');
  });
});

// ────────────────────────────────── Site Repository ──────────────────────────────────

describe('siteRepository', () => {
  it('creates a site with correct fields', async () => {
    const site = await createSite(db, {
      name: 'Main Office',
      addressLine1: '123 Main St',
      city: 'Anytown',
      state: 'CA',
      postalCode: '90210',
      country: 'USA',
      notes: 'Corner building',
    });

    expect(site).toBeDefined();
    expect(site.id).toMatch(/^mock-uuid-/);
    expect(site.name).toBe('Main Office');
    expect(site.addressLine1).toBe('123 Main St');
    expect(site.city).toBe('Anytown');
    expect(site.state).toBe('CA');
    expect(site.postalCode).toBe('90210');
    expect(site.country).toBe('USA');
    expect(site.notes).toBe('Corner building');
    expect(site.clientId).toBeNull();
    expect(site.syncStatus).toBe('local_only');
    expect(site.deletedAt).toBeNull();
  });

  it('getSiteById retrieves a created site', async () => {
    const created = await createSite(db, { name: 'Test Site' });
    const found = await getSiteById(db, created.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(created.id);
    expect(found!.name).toBe('Test Site');
  });

  it('getSiteById returns null for non-existent id', async () => {
    const result = await getSiteById(db, 'non-existent');
    expect(result).toBeNull();
  });

  it('getAllSites returns sites sorted by name', async () => {
    await createSite(db, { name: 'Z Site' });
    await createSite(db, { name: 'A Site' });
    await createSite(db, { name: 'M Site' });

    const sites = await getAllSites(db);
    expect(sites).toHaveLength(3);
    expect(sites[0].name).toBe('A Site');
    expect(sites[1].name).toBe('M Site');
    expect(sites[2].name).toBe('Z Site');
  });

  it('getAllSites excludes soft-deleted sites', async () => {
    const s1 = await createSite(db, { name: 'Keep' });
    const s2 = await createSite(db, { name: 'Delete' });
    await deleteSite(db, s2.id);

    const sites = await getAllSites(db);
    expect(sites).toHaveLength(1);
    expect(sites[0].id).toBe(s1.id);
  });

  it('getSitesByClientId returns only matching sites', async () => {
    const client1 = await createClient(db, { name: 'Client A' });
    const client2 = await createClient(db, { name: 'Client B' });

    const s1 = await createSite(db, { name: 'Site A1', clientId: client1.id });
    const s2 = await createSite(db, { name: 'Site A2', clientId: client1.id });
    await createSite(db, { name: 'Site B1', clientId: client2.id });

    const sites = await getSitesByClientId(db, client1.id);
    expect(sites).toHaveLength(2);
    expect(sites.map((s) => s.id)).toEqual([s1.id, s2.id]);
  });

  it('getSitesByClientId returns empty array for client with no sites', async () => {
    const client = await createClient(db, { name: 'Lonely Client' });
    const sites = await getSitesByClientId(db, client.id);
    expect(sites).toEqual([]);
  });

  it('updateSite modifies fields', async () => {
    const site = await createSite(db, { name: 'Old Site', city: 'Old City' });
    await later();
    const updated = await updateSite(db, site.id, { name: 'New Site', city: 'New City', state: 'NY' });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe('New Site');
    expect(updated!.city).toBe('New City');
    expect(updated!.state).toBe('NY');
  });

  it('updateSite returns null for non-existent id', async () => {
    const result = await updateSite(db, 'non-existent', { name: 'Nope' });
    expect(result).toBeNull();
  });

  it('deleteSite soft-deletes and returns true', async () => {
    const site = await createSite(db, { name: 'Delete Me' });
    const result = await deleteSite(db, site.id);
    expect(result).toBe(true);

    const found = await getSiteById(db, site.id);
    expect(found).toBeNull();
  });

  it('deleteSite returns false for non-existent id', async () => {
    const result = await deleteSite(db, 'non-existent');
    expect(result).toBe(false);
  });

  it('upsertSite inserts a new record', async () => {
    const id = 'upsert-site-id';
    const now = new Date().toISOString();
    await upsertSite(db, {
      id,
      userId: 'user1',
      clientId: null,
      name: 'Upserted Site',
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      postalCode: null,
      country: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
    });

    const found = await getSiteById(db, id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Upserted Site');
    expect(found!.syncStatus).toBe('synced');
  });

  it('upsertSite updates when remote is newer', async () => {
    const site = await createSite(db, { name: 'Old Site' });
    await later();
    const newDate = new Date().toISOString();
    await upsertSite(db, {
      id: site.id,
      userId: 'local_user',
      clientId: null,
      name: 'Updated Site',
      addressLine1: '456 New St',
      addressLine2: null,
      city: null,
      state: null,
      postalCode: null,
      country: null,
      notes: 'Updated notes',
      createdAt: site.createdAt,
      updatedAt: newDate,
    });

    const found = await getSiteById(db, site.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Updated Site');
    expect(found!.addressLine1).toBe('456 New St');
    expect(found!.notes).toBe('Updated notes');
  });

  it('upsertSite does NOT update when remote is older', async () => {
    const site = await createSite(db, { name: 'Keep Site' });
    await upsertSite(db, {
      id: site.id,
      userId: 'local_user',
      clientId: null,
      name: 'Should Not Apply',
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      postalCode: null,
      country: null,
      notes: null,
      createdAt: site.createdAt,
      updatedAt: '2020-01-01T00:00:00.000Z',
    });

    const found = await getSiteById(db, site.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Keep Site');
  });
});
