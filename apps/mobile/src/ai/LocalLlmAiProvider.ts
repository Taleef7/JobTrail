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
import { ModelManager } from './ModelManager';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Conditional native-module import
// ---------------------------------------------------------------------------
let llamaRn: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  llamaRn = require('llama.rn');
} catch {
  // Native module not available — web, CI, or missing native build.
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const LOCAL_TIMEOUT_MS = 15000;

const EXTRACTION_PROMPT = `You are an information extraction engine for a field-service job documentation app.

Extract structured job information from the user's rough field note.

Rules:
- Return only valid JSON matching the required schema.
- Do not invent details.
- If a value is missing, omit it or add it to missingFields.
- Keep workPerformed as short action statements.
- Keep followUpNotes separate from completed work.
- Do not overwrite user intent.
- If unsure, use lower confidence.

Field note:
{{input}}`;

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
// Helper: run local inference with timeout
// ---------------------------------------------------------------------------
async function runLocalInference(prompt: string, jsonSchema: object): Promise<string> {
  const modelPath = ModelManager.getInstance().getModelPath();

  const context = await llamaRn.initLlama({
    model: modelPath,
    is_model_asset: false,
    n_ctx: 2048,
    n_threads: 4,
    cache_type_k: 'q8_0',
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Local LLM request timed out')), LOCAL_TIMEOUT_MS),
  );

  const completionPromise = context.completion({
    prompt,
    temperature: 0.1,
    n_predict: 256,
    n_threads: 4,
    json_schema: JSON.stringify(jsonSchema),
  });

  try {
    const result = await Promise.race([completionPromise, timeoutPromise]);
    return result.text;
  } finally {
    await context.release();
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * LocalLlmAiProvider runs a Gemma 4 E2B QAT GGUF model on-device via llama.rn.
 * Only available when EXPO_PUBLIC_ENABLE_LOCAL_LLM === 'true' and the model
 * file has been downloaded.
 */
export class LocalLlmAiProvider implements AiProvider {
  /** Whether the native module is available and the feature flag is on. */
  static isAvailable(): boolean {
    if (!llamaRn) return false;
    return (
      process.env.EXPO_PUBLIC_ENABLE_LOCAL_LLM === 'true' &&
      ModelManager.getInstance().getStatus() === 'ready'
    );
  }

  async extractJobFields(input: JobExtractionInput): Promise<JobExtractionResult> {
    const start = Date.now();
    const prompt = EXTRACTION_PROMPT.replace('{{input}}', input.noteText);

    try {
      const text = await runLocalInference(prompt, EXTRACTION_JSON_SCHEMA);
      const result = parseLlmResponse(text, JobExtractionResultSchema);
      logAiCall({ method: 'extractJobFields', model: 'local-llm', attempt: 0, outcome: 'ok', durationMs: Date.now() - start });
      return result;
    } catch (err) {
      const durationMs = Date.now() - start;
      const errorMessage = err instanceof Error ? err.message : String(err);
      logAiCall({ method: 'extractJobFields', model: 'local-llm', attempt: 0, outcome: 'network_error', durationMs, errorMessage });
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
      const text = await runLocalInference(prompt, SUMMARY_JSON_SCHEMA);
      const result = parseLlmResponse(text, JobSummaryResponseSchema) as any;
      logAiCall({ method: 'summarizeJob', model: 'local-llm', attempt: 0, outcome: 'ok', durationMs: Date.now() - start });
      return {
        summary: result.summary ?? result.data?.summary ?? '',
        customerVisibleSummary: result.customerVisibleSummary ?? result.data?.customerVisibleSummary ?? result.summary ?? result.data?.summary ?? '',
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      const errorMessage = err instanceof Error ? err.message : String(err);
      logAiCall({ method: 'summarizeJob', model: 'local-llm', attempt: 0, outcome: 'network_error', durationMs, errorMessage });
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

    logAiCall({ method: 'suggestMissingFields', model: 'local-llm', attempt: 0, outcome: 'ok', durationMs: Date.now() - start });
    return { missingFields: missing, suggestions };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse and Zod-validate the raw text response from the local LLM.
 * The schema type parameter lets us reuse this for both extraction and summary.
 */
function parseLlmResponse<T>(text: string, schema: z.ZodType<T>): T {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new AiParseError('No JSON found in local LLM response');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(jsonMatch[0]);
  } catch (err) {
    throw new AiParseError('Local LLM response was not valid JSON', err);
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new AiParseError(`Local LLM response failed schema validation: ${issues}`);
  }

  return result.data;
}

function wrapError(err: unknown): AiError {
  const msg = err instanceof Error ? err.message : String(err);
  const kind = classifyLocalError(err);
  return new AiError(msg, kind, err instanceof Error ? err : undefined);
}

function classifyLocalError(err: unknown): AiError['kind'] {
  if (!err) return 'unknown';
  const msg = String(err).toLowerCase();
  if (msg.includes('timed out')) return 'timeout';
  if (msg.includes('network') || msg.includes('fetch')) return 'network';
  if (err instanceof AiParseError) return 'parse';
  return 'unknown';
}
