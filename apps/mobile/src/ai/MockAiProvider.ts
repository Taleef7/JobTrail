import type {
  JobExtractionInput,
  JobExtractionResult,
  JobSummaryInput,
  JobSummaryResult,
  MissingFieldInput,
  MissingFieldResult,
} from '../domain/types';
import type { AiProvider } from './AiProvider';

/**
 * MockAiProvider returns hardcoded extraction results for testing.
 * It does not perform any real analysis.
 */
export class MockAiProvider implements AiProvider {
  async extractJobFields(input: JobExtractionInput): Promise<JobExtractionResult> {
    return {
      jobType: 'general',
      workPerformed: ['Work performed based on note'],
      issuesFound: [],
      materials: [
        { name: 'Material from note', quantity: 1, unit: 'each' },
      ],
      durationMinutes: 30,
      customerApproved: false,
      followUpNotes: [],
      missingFields: ['customerApproval', 'materials'],
      confidence: 0.3,
    };
  }

  async summarizeJob(input: JobSummaryInput): Promise<JobSummaryResult> {
    const materials = input.materials.map((m) => `${m.quantity} ${m.unit ?? ''} ${m.name}`).join(', ');
    const totalMinutes = input.timeEntries.reduce((sum, t) => sum + (t.durationMinutes ?? 0), 0);

    return {
      summary: `Work completed on "${input.job.title}". Materials used: ${materials || 'none'}. Total labor: ${totalMinutes} minutes.`,
      customerVisibleSummary: `Job "${input.job.title}" has been completed. Total time: ${totalMinutes} minutes. Materials: ${materials || 'none'}.`,
    };
  }

  async suggestMissingFields(input: MissingFieldInput): Promise<MissingFieldResult> {
    const missing: string[] = [];
    const suggestions: Record<string, string> = {};

    if (input.materials.length === 0) {
      missing.push('materials');
      suggestions['materials'] = 'Consider adding materials used on this job.';
    }
    if (input.timeEntries.length === 0) {
      missing.push('timeEntries');
      suggestions['timeEntries'] = 'Consider adding time spent on this job.';
    }

    return { missingFields: missing, suggestions };
  }
}