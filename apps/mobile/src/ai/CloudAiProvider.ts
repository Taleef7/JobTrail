import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
import { z } from 'zod';
import { JobExtractionResultSchema } from '../domain/schemas';
import type { AiProvider } from './AiProvider';
import type {
  JobExtractionInput,
  JobExtractionResult,
  JobSummaryInput,
  JobSummaryResult,
  MissingFieldInput,
  MissingFieldResult,
} from '../domain/types';

export const GEMINI_MODELS = {
  PRIMARY: 'gemini-3.1-flash-lite',
  FALLBACK: 'gemini-3.5-flash',
} as const;

class AiParseError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'AiParseError';
  }
}

const GEMINI_TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;
const RATE_LIMIT_RPM = 55;

const EXTRACTION_PROMPT = `You are an information extraction engine for a field-service job documentation app.

Extract structured job information from the user's rough field note.

Rules:
- Return only valid JSON.
- Do not invent details.
- If a value is missing, omit it or add it to missingFields.
- Keep workPerformed as short action statements.
- Keep followUpNotes separate from completed work.
- Do not overwrite user intent.
- If unsure, use lower confidence.

Required JSON shape:
{
  "jobType": string | null,
  "workPerformed": string[],
  "issuesFound": string[],
  "materials": [
    {
      "name": string,
      "quantity": number | null,
      "unit": string | null,
      "estimatedCost": number | null
    }
  ],
  "durationMinutes": number | null,
  "customerApproved": boolean | null,
  "followUpNotes": string[],
  "missingFields": string[],
  "confidence": number
}

Field note:
{{input}}`;

let lastRequestTimestamps: number[] = [];

async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const windowStart = now - 60000;
  lastRequestTimestamps = lastRequestTimestamps.filter((t) => t > windowStart);

  if (lastRequestTimestamps.length >= RATE_LIMIT_RPM) {
    const oldest = lastRequestTimestamps[0];
    const waitMs = oldest + 60000 - now + 100;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  lastRequestTimestamps.push(Date.now());
}

async function fetchWithTimeout(
  model: GenerativeModel,
  prompt: string,
  timeoutMs: number
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await model.generateContent(prompt);
    clearTimeout(timeoutId);
    return result.response.text();
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (controller.signal.aborted) {
      throw new Error('Gemini request timed out');
    }
    throw error;
  }
}

function parseExtractionResponse(text: string): JobExtractionResult {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new AiParseError('No JSON found in Gemini response');
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(jsonMatch[0]);
  } catch (err) {
    throw new AiParseError('Gemini response was not valid JSON', err);
  }

  const result = JobExtractionResultSchema.safeParse(rawJson);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`,
    ).join('; ');
    throw new AiParseError(
      `Gemini response failed schema validation: ${issues}`,
    );
  }

  return result.data;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const JobSummaryResponseSchema = z.object({
  summary: z.string().default(''),
  customerVisibleSummary: z.string().optional(),
});

export class CloudAiProvider implements AiProvider {
  private model: GenerativeModel;
  private fallbackModel: GenerativeModel;

  constructor(apiKey: string, modelName = GEMINI_MODELS.PRIMARY) {
    const genAI = new GoogleGenerativeAI(apiKey);
    this.model = genAI.getGenerativeModel({ model: modelName });
    this.fallbackModel = genAI.getGenerativeModel({ model: GEMINI_MODELS.FALLBACK });
  }

  async extractJobFields(input: JobExtractionInput): Promise<JobExtractionResult> {
    const prompt = EXTRACTION_PROMPT.replace('{{input}}', input.noteText);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await waitForRateLimit();

        let text: string;
        try {
          text = await fetchWithTimeout(this.model, prompt, GEMINI_TIMEOUT_MS);
        } catch {
          text = await fetchWithTimeout(this.fallbackModel, prompt, GEMINI_TIMEOUT_MS);
        }

        return parseExtractionResponse(text);
      } catch (error: any) {
        lastError = error;
        if (attempt < MAX_RETRIES - 1) {
          await sleep(Math.pow(2, attempt) * 1000);
        }
      }
    }

    throw lastError || new Error('Gemini extraction failed after retries');
  }

  async summarizeJob(input: JobSummaryInput): Promise<JobSummaryResult> {
    const totalMinutes = input.timeEntries.reduce(
      (s, t) => s + (t.durationMinutes ?? 0),
      0,
    );
    const prompt = [
      'Summarize this field service job in 2-3 sentences for the customer.',
      '',
      `Title: ${input.job.title}`,
      `Type: ${input.job.jobType || 'N/A'}`,
      `Notes: ${input.notes.map((n) => n.content).join('; ') || 'none'}`,
      `Materials: ${
        input.materials
          .map((m) => `${m.quantity ?? 1} ${m.unit ?? ''} ${m.name}`)
          .join(', ') || 'none'
      }`,
      `Total time: ${totalMinutes} minutes`,
      '',
      'Return a JSON object: { "summary": string, "customerVisibleSummary": string }',
    ].join('\n');

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await waitForRateLimit();
        let text: string;
        try {
          text = await fetchWithTimeout(this.model, prompt, GEMINI_TIMEOUT_MS);
        } catch {
          text = await fetchWithTimeout(
            this.fallbackModel,
            prompt,
            GEMINI_TIMEOUT_MS,
          );
        }
        return this.parseSummaryResponse(text);
      } catch (err) {
        lastError = err as Error;
        if (attempt < MAX_RETRIES - 1) {
          await sleep(Math.pow(2, attempt) * 1000);
        }
      }
    }
    throw lastError || new Error('Gemini summary failed after retries');
  }

  private parseSummaryResponse(text: string): JobSummaryResult {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match)
      throw new AiParseError('No JSON found in Gemini summary response');

    let raw: unknown;
    try {
      raw = JSON.parse(match[0]);
    } catch (err) {
      throw new AiParseError('Gemini summary was not valid JSON', err);
    }

    const parsed = JobSummaryResponseSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new AiParseError(
        `Gemini summary failed schema validation: ${issues}`,
      );
    }

    return {
      summary: parsed.data.summary,
      customerVisibleSummary:
        parsed.data.customerVisibleSummary ?? parsed.data.summary,
    };
  }

  async suggestMissingFields(
    input: MissingFieldInput,
  ): Promise<MissingFieldResult> {
    const missing: string[] = [];
    const suggestions: Record<string, string> = {};

    // Detection (same logic as RuleBasedAiProvider)
    if (input.materials.length === 0) {
      missing.push('materials');
      suggestions['materials'] =
        'No materials recorded for this job yet.';
    }
    if (input.timeEntries.length === 0) {
      missing.push('timeEntries');
      suggestions['timeEntries'] =
        'No labor time recorded for this job yet.';
    }
    if (!input.job.jobType) {
      missing.push('jobType');
      suggestions['jobType'] =
        'No job type set. Add a type (e.g. plumbing, electrical).';
    }
    if (
      !input.job.customerVisibleSummary &&
      !input.job.structuredSummary
    ) {
      missing.push('summary');
      suggestions['summary'] =
        'No summary generated yet. Run "Generate Report" to create one.';
    }

    // Optionally enhance with Gemini suggestions when fields are missing
    if (missing.length > 0) {
      try {
        await waitForRateLimit();
        const prompt = [
          'Suggest brief values for these missing job fields based on job context.',
          '',
          `Job title: ${input.job.title}`,
          `Job type: ${input.job.jobType ?? 'unknown'}`,
          `Existing notes: ${
            input.notes.map((n) => n.content).join('; ') || 'none'
          }`,
          `Missing fields: ${missing.join(', ')}`,
          '',
          'Return JSON: { "suggestions": { "<field>": "<value>" } }',
          'Only suggest values you can justify from the context. If unsure, omit the field.',
        ].join('\n');

        const text = await fetchWithTimeout(
          this.model,
          prompt,
          GEMINI_TIMEOUT_MS,
        );
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (parsed.suggestions && typeof parsed.suggestions === 'object') {
            Object.assign(suggestions, parsed.suggestions);
          }
        }
      } catch {
        // Best-effort: keep the detection-only suggestions on any failure.
      }
    }

    return { missingFields: missing, suggestions };
  }
}
