import { Platform } from 'react-native';
import { JobExtractionResultSchema } from '../domain/schemas';
import type {
  JobExtractionInput,
  JobExtractionResult,
  JobSummaryInput,
  JobSummaryResult,
  MissingFieldInput,
  MissingFieldResult,
} from '../domain/types';
import type { AiProvider } from './AiProvider';
import { AiError, AiParseError, logAiCall } from './CloudAiProvider';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Conditional native-module import
// ---------------------------------------------------------------------------
let appleAI: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  appleAI = require('@react-native-ai/apple');
} catch {
  // Native module not available — web, CI, or older iOS.
}

// ---------------------------------------------------------------------------
// JSON schemas for structured-output constraints
// ---------------------------------------------------------------------------

const EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    jobType: { type: ['string', 'null'] },
    workPerformed: { type: 'array', items: { type: 'string' } },
    issuesFound: { type: 'array', items: { type: 'string' } },
    materials: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: ['number', 'null'] },
          unit: { type: ['string', 'null'] },
          estimatedCost: { type: ['number', 'null'] },
        },
        required: ['name'],
      },
    },
    durationMinutes: { type: ['number', 'null'] },
    customerApproved: { type: ['boolean', 'null'] },
    followUpNotes: { type: 'array', items: { type: 'string' } },
    missingFields: { type: 'array', items: { type: 'string' } },
    confidence: { type: ['number', 'null'] },
  },
  required: ['workPerformed', 'issuesFound', 'materials', 'followUpNotes', 'missingFields'],
};

const SUMMARY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    customerVisibleSummary: { type: 'string' },
  },
  required: ['summary'],
};

const JobSummaryResponseSchema = z.object({
  summary: z.string().default(''),
  customerVisibleSummary: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether the Apple Foundation Models runtime is available.
 * Requires iOS 26+ and the native module to be linked.
 */
function isAppleAiAvailable(): boolean {
  if (!appleAI?.AppleFoundationModels) return false;
  if (Platform.OS !== 'ios') return false;

  const version = typeof Platform.Version === 'string'
    ? parseFloat(Platform.Version)
    : Platform.Version;
  if (version < 26) return false;

  try {
    return appleAI.AppleFoundationModels.isAvailable() === true;
  } catch {
    return false;
  }
}

/**
 * Parse a Zod-validated result from the Apple Foundation Models response text.
 */
function parseAppleResponse<T>(text: string, schema: z.ZodType<T>): T {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new AiParseError('No JSON found in Apple Foundation response');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(jsonMatch[0]);
  } catch (err) {
    throw new AiParseError('Apple Foundation response was not valid JSON', err);
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new AiParseError(`Apple Foundation response failed schema validation: ${issues}`);
  }

  return result.data;
}

/**
 * Run Apple Foundation Models inference with a timeout.
 */
async function runAppleInference(
  prompt: string,
  jsonSchema: object,
): Promise<string> {
  const messages = [{ role: 'user', content: prompt }];

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Apple Foundation request timed out')), 15000),
  );

  const generatePromise = appleAI.AppleFoundationModels.generateText(messages, {
    temperature: 0.1,
    maxTokens: 256,
    schema: jsonSchema,
  });

  const results = await Promise.race([generatePromise, timeoutPromise]);

  // results is an array of { type: 'text', text: string } | { type: 'tool-call', ... }
  const textResult = Array.isArray(results)
    ? results.find((r: any) => r.type === 'text')
    : null;

  if (!textResult?.text) {
    throw new AiParseError('Apple Foundation returned no text output');
  }

  return textResult.text;
}

function wrapError(err: unknown): AiError {
  const msg = err instanceof Error ? err.message : String(err);
  const kind = classifyAppleError(err);
  return new AiError(msg, kind, err instanceof Error ? err : undefined);
}

function classifyAppleError(err: unknown): AiError['kind'] {
  if (!err) return 'unknown';
  const msg = String(err).toLowerCase();
  if (msg.includes('timed out')) return 'timeout';
  if (msg.includes('network') || msg.includes('fetch')) return 'network';
  if (err instanceof AiParseError) return 'parse';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * AppleAiProvider wraps @react-native-ai/apple (Apple Foundation Models)
 * for on-device LLM inference on iOS 26+ devices.
 */
export class AppleAiProvider implements AiProvider {
  /** Whether the Apple Foundation Models runtime is currently usable. */
  static isAvailable(): boolean {
    return isAppleAiAvailable();
  }

  async extractJobFields(input: JobExtractionInput): Promise<JobExtractionResult> {
    const start = Date.now();
    const prompt = [
      'You are an information extraction engine for a field-service job documentation app.',
      '',
      'Extract structured job information from the user\'s rough field note.',
      '',
      'Rules:',
      '- Return only valid JSON matching the required schema.',
      '- Do not invent details.',
      '- If a value is missing, omit it or add it to missingFields.',
      '- Keep workPerformed as short action statements.',
      '- Keep followUpNotes separate from completed work.',
      '- Do not overwrite user intent.',
      '- If unsure, use lower confidence.',
      '',
      `Field note:\n${input.noteText}`,
    ].join('\n');

    try {
      const text = await runAppleInference(prompt, EXTRACTION_JSON_SCHEMA);
      const result = parseAppleResponse(text, JobExtractionResultSchema);
      logAiCall({ method: 'extractJobFields', model: 'apple-foundation', attempt: 0, outcome: 'ok', durationMs: Date.now() - start });
      return result;
    } catch (err) {
      const durationMs = Date.now() - start;
      const errorMessage = err instanceof Error ? err.message : String(err);
      logAiCall({ method: 'extractJobFields', model: 'apple-foundation', attempt: 0, outcome: 'network_error', durationMs, errorMessage });
      throw err instanceof AiError ? err : wrapError(err);
    }
  }

  async summarizeJob(input: JobSummaryInput): Promise<JobSummaryResult> {
    const start = Date.now();
    const totalMinutes = input.timeEntries.reduce((s, t) => s + (t.durationMinutes ?? 0), 0);
    const prompt = [
      'Summarize this field service job in 2-3 sentences for the customer.',
      '',
      `Title: ${input.job.title}`,
      `Type: ${input.job.jobType || 'N/A'}`,
      `Notes: ${input.notes.map((n) => n.content).join('; ') || 'none'}`,
      `Materials: ${input.materials.map((m) => `${m.quantity ?? 1} ${m.unit ?? ''} ${m.name}`).join(', ') || 'none'}`,
      `Total time: ${totalMinutes} minutes`,
      '',
      'Return a JSON object: { "summary": string, "customerVisibleSummary": string }',
    ].join('\n');

    try {
      const text = await runAppleInference(prompt, SUMMARY_JSON_SCHEMA);
      const result = parseAppleResponse(text, JobSummaryResponseSchema);
      logAiCall({ method: 'summarizeJob', model: 'apple-foundation', attempt: 0, outcome: 'ok', durationMs: Date.now() - start });
      return {
        summary: result.summary,
        customerVisibleSummary: result.customerVisibleSummary ?? result.summary,
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      const errorMessage = err instanceof Error ? err.message : String(err);
      logAiCall({ method: 'summarizeJob', model: 'apple-foundation', attempt: 0, outcome: 'network_error', durationMs, errorMessage });
      throw err instanceof AiError ? err : wrapError(err);
    }
  }

  async suggestMissingFields(input: MissingFieldInput): Promise<MissingFieldResult> {
    const start = Date.now();
    const missing: string[] = [];
    const suggestions: Record<string, string> = {};

    if (input.materials.length === 0) {
      missing.push('materials');
      suggestions['materials'] = 'No materials recorded for this job yet.';
    }
    if (input.timeEntries.length === 0) {
      missing.push('timeEntries');
      suggestions['timeEntries'] = 'No labor time recorded for this job yet.';
    }
    if (!input.job.jobType) {
      missing.push('jobType');
      suggestions['jobType'] = 'No job type set. Add a type (e.g. plumbing, electrical).';
    }
    if (!input.job.customerVisibleSummary && !input.job.structuredSummary) {
      missing.push('summary');
      suggestions['summary'] = 'No summary generated yet. Run "Generate Report" to create one.';
    }

    logAiCall({ method: 'suggestMissingFields', model: 'apple-foundation', attempt: 0, outcome: 'ok', durationMs: Date.now() - start });
    return { missingFields: missing, suggestions };
  }
}
