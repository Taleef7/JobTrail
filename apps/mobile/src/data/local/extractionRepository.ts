import { v4 as uuidv4 } from 'uuid';
import type { AiExtractionResult } from '../../domain/types';
import type { AppDatabase } from './types';

function now(): string {
  return new Date().toISOString();
}

export async function createExtractionResult(
  db: AppDatabase,
  input: {
    jobId: string;
    sourceType: string;
    sourceId?: string;
    provider: string;
    modelName?: string;
    inputText: string;
    extractedJson: string;
    confidence?: number;
  },
  userId: string = 'local_user'
): Promise<AiExtractionResult> {
  const id = uuidv4();
  const timestamp = now();

  const result: AiExtractionResult = {
    id,
    jobId: input.jobId,
    userId,
    sourceType: input.sourceType,
    sourceId: input.sourceId ?? null,
    provider: input.provider,
    modelName: input.modelName ?? null,
    inputText: input.inputText,
    extractedJson: input.extractedJson,
    confidence: input.confidence ?? null,
    createdAt: timestamp,
    acceptedAt: null,
    rejectedAt: null,
  };

  await db.runAsync(
    `INSERT INTO ai_extraction_results (id, jobId, userId, sourceType, sourceId, provider, modelName, inputText, extractedJson, confidence, createdAt, acceptedAt, rejectedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      result.id, result.jobId, result.userId, result.sourceType, result.sourceId,
      result.provider, result.modelName, result.inputText, result.extractedJson,
      result.confidence, result.createdAt, result.acceptedAt, result.rejectedAt,
    ]
  );

  return result;
}

export async function getExtractionResultsByJobId(db: AppDatabase, jobId: string): Promise<AiExtractionResult[]> {
  return db.getAllAsync<AiExtractionResult>(
    'SELECT * FROM ai_extraction_results WHERE jobId = ? ORDER BY createdAt DESC',
    [jobId]
  );
}

export async function getExtractionResultById(db: AppDatabase, id: string): Promise<AiExtractionResult | null> {
  const row = await db.getFirstAsync<AiExtractionResult>(
    'SELECT * FROM ai_extraction_results WHERE id = ?',
    [id]
  );
  return row ?? null;
}

export async function acceptExtractionResult(db: AppDatabase, id: string): Promise<AiExtractionResult | null> {
  const timestamp = now();
  await db.runAsync(
    'UPDATE ai_extraction_results SET acceptedAt = ? WHERE id = ?',
    [timestamp, id]
  );
  return getExtractionResultById(db, id);
}

export async function rejectExtractionResult(db: AppDatabase, id: string): Promise<AiExtractionResult | null> {
  const timestamp = now();
  await db.runAsync(
    'UPDATE ai_extraction_results SET rejectedAt = ? WHERE id = ?',
    [timestamp, id]
  );
  return getExtractionResultById(db, id);
}