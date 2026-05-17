// Domain types for JobTrail
// These are the core business entities used throughout the app.

export type JobStatus = 'draft' | 'scheduled' | 'in_progress' | 'completed' | 'archived';
export type SyncStatus = 'local_only' | 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict';
export type NoteType = 'manual' | 'voice' | 'ai_generated';
export type AiStatus = 'not_started' | 'processing' | 'completed' | 'failed';

export interface Job {
  id: string;
  userId: string;
  title: string;
  jobType: string | null;
  status: JobStatus;
  priority: string;
  roughNotes: string | null;
  structuredSummary: string | null;
  internalNotes: string | null;
  customerVisibleSummary: string | null;
  aiStatus: AiStatus;
  syncStatus: SyncStatus;
  createdAt: string;
  updatedAt: string;
}

export interface JobNote {
  id: string;
  jobId: string;
  userId: string;
  noteType: NoteType;
  content: string;
  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus;
}

export interface MaterialLineItem {
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
  syncStatus: SyncStatus;
}

export interface TimeEntry {
  id: string;
  jobId: string;
  userId: string;
  startedAt: string | null;
  endedAt: string | null;
  durationMinutes: number | null;
  description: string | null;
  billable: boolean;
  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus;
}

export interface AiExtractionResult {
  id: string;
  jobId: string;
  userId: string;
  sourceType: string;
  sourceId: string | null;
  provider: string;
  modelName: string | null;
  inputText: string;
  extractedJson: string;
  confidence: number | null;
  createdAt: string;
  acceptedAt: string | null;
  rejectedAt: string | null;
}

// View model for report preview
export interface JobReportViewModel {
  title: string;
  clientName?: string;
  siteAddress?: string;
  jobDate?: string;
  technicianName?: string;
  workPerformed: string[];
  materials: {
    name: string;
    quantity?: number;
    unit?: string;
  }[];
  laborMinutes?: number;
  followUpNotes: string[];
  customerApproved?: boolean;
  notes: string[];
}

// Input/output types for AI extraction
export interface JobExtractionInput {
  noteText: string;
  jobId: string;
}

export interface ExtractedMaterial {
  name: string;
  quantity?: number;
  unit?: string;
  estimatedCost?: number;
}

export interface JobExtractionResult {
  jobType?: string;
  workPerformed: string[];
  issuesFound: string[];
  materials: ExtractedMaterial[];
  durationMinutes?: number;
  customerApproved?: boolean;
  followUpNotes: string[];
  missingFields: string[];
  confidence?: number;
}

export interface JobSummaryInput {
  job: Job;
  notes: JobNote[];
  materials: MaterialLineItem[];
  timeEntries: TimeEntry[];
}

export interface JobSummaryResult {
  summary: string;
  customerVisibleSummary: string;
}

export interface MissingFieldInput {
  job: Job;
  notes: JobNote[];
  materials: MaterialLineItem[];
  timeEntries: TimeEntry[];
}

export interface MissingFieldResult {
  missingFields: string[];
  suggestions: Record<string, string>;
}

export type User = {
  id: string;
  cloudUid: string;
  email: string;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string | null;
};

export type PhotoAsset = {
  id: string;
  jobId: string;
  userId: string;
  localUri: string;
  remoteUrl: string | null;
  photoType: 'before' | 'after' | 'general' | 'issue' | 'material';
  caption: string | null;
  takenAt: string | null;
  uploadStatus: 'pending' | 'uploading' | 'uploaded' | 'failed';
  syncStatus: 'local_only' | 'pending' | 'syncing' | 'synced' | 'failed';
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type SyncOperation = {
  id: string;
  entityType: string;
  entityId: string;
  operationType: 'create' | 'update' | 'delete';
  payloadJson: string;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  retryCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
};