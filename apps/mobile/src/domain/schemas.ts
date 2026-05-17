import { z } from 'zod';

// Zod schemas for runtime validation

export const JobStatusSchema = z.enum([
  'draft',
  'scheduled',
  'in_progress',
  'completed',
  'archived',
]);

export const SyncStatusSchema = z.enum([
  'local_only',
  'pending',
  'syncing',
  'synced',
  'failed',
  'conflict',
]);

export const NoteTypeSchema = z.enum(['manual', 'voice', 'ai_generated']);

export const AiStatusSchema = z.enum([
  'not_started',
  'processing',
  'completed',
  'failed',
]);

export const JobSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string().min(1, 'Job title is required'),
  jobType: z.string().nullable(),
  status: JobStatusSchema,
  priority: z.string().default('normal'),
  roughNotes: z.string().nullable(),
  structuredSummary: z.string().nullable(),
  internalNotes: z.string().nullable(),
  customerVisibleSummary: z.string().nullable(),
  aiStatus: AiStatusSchema,
  syncStatus: SyncStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const CreateJobSchema = z.object({
  title: z.string().min(1, 'Job title is required'),
  jobType: z.string().optional(),
  priority: z.string().default('normal'),
  roughNotes: z.string().optional(),
});

export const JobNoteSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  userId: z.string(),
  noteType: NoteTypeSchema,
  content: z.string().min(1, 'Note content is required'),
  createdAt: z.string(),
  updatedAt: z.string(),
  syncStatus: SyncStatusSchema,
});

export const CreateNoteSchema = z.object({
  content: z.string().min(1, 'Note content is required'),
  noteType: NoteTypeSchema.default('manual'),
});

export const MaterialLineItemSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  userId: z.string(),
  name: z.string().min(1, 'Material name is required'),
  quantity: z.number().default(1),
  unit: z.string().nullable(),
  unitCost: z.number().nullable(),
  totalCost: z.number().nullable(),
  billable: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
  syncStatus: SyncStatusSchema,
});

export const CreateMaterialSchema = z.object({
  name: z.string().min(1, 'Material name is required'),
  quantity: z.number().positive().default(1),
  unit: z.string().optional(),
  unitCost: z.number().optional(),
});

export const TimeEntrySchema = z.object({
  id: z.string(),
  jobId: z.string(),
  userId: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  durationMinutes: z.number().nullable(),
  description: z.string().nullable(),
  billable: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
  syncStatus: SyncStatusSchema,
});

export const CreateTimeEntrySchema = z.object({
  durationMinutes: z.number().positive('Duration must be positive'),
  description: z.string().optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
});

export const ExtractedMaterialSchema = z.object({
  name: z.string(),
  quantity: z.number().optional(),
  unit: z.string().optional(),
  estimatedCost: z.number().optional(),
});

export const JobExtractionResultSchema = z.object({
  jobType: z.string().optional(),
  workPerformed: z.array(z.string()).default([]),
  issuesFound: z.array(z.string()).default([]),
  materials: z.array(ExtractedMaterialSchema).default([]),
  durationMinutes: z.number().optional(),
  customerApproved: z.boolean().optional(),
  followUpNotes: z.array(z.string()).default([]),
  missingFields: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional(),
});

export const AiExtractionResultSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  userId: z.string(),
  sourceType: z.string(),
  sourceId: z.string().nullable(),
  provider: z.string(),
  modelName: z.string().nullable(),
  inputText: z.string(),
  extractedJson: z.string(),
  confidence: z.number().nullable(),
  createdAt: z.string(),
  acceptedAt: z.string().nullable(),
  rejectedAt: z.string().nullable(),
});

export const UserSchema = z.object({
  id: z.string(),
  cloudUid: z.string(),
  email: z.string().email(),
  displayName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastSyncedAt: z.string().nullable(),
});

export const PhotoAssetSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  userId: z.string(),
  localUri: z.string(),
  remoteUrl: z.string().nullable(),
  photoType: z.enum(['before', 'after', 'general', 'issue', 'material']),
  caption: z.string().nullable(),
  takenAt: z.string().nullable(),
  uploadStatus: z.enum(['pending', 'uploading', 'uploaded', 'failed']),
  syncStatus: z.enum(['local_only', 'pending', 'syncing', 'synced', 'failed']),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});

export const SyncOperationSchema = z.object({
  id: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  operationType: z.enum(['create', 'update', 'delete']),
  payloadJson: z.string(),
  status: z.enum(['pending', 'syncing', 'synced', 'failed']),
  retryCount: z.number().int().default(0),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  processedAt: z.string().nullable(),
});