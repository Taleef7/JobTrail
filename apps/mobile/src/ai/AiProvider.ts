import type {
  JobExtractionInput,
  JobExtractionResult,
  JobSummaryInput,
  JobSummaryResult,
  MissingFieldInput,
  MissingFieldResult,
} from '../domain/types';

export interface AiProvider {
  extractJobFields(input: JobExtractionInput): Promise<JobExtractionResult>;
  summarizeJob(input: JobSummaryInput): Promise<JobSummaryResult>;
  suggestMissingFields(input: MissingFieldInput): Promise<MissingFieldResult>;
}