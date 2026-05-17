import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
import type { AiProvider } from './AiProvider';
import type {
  JobExtractionInput,
  JobExtractionResult,
  JobSummaryInput,
  JobSummaryResult,
  MissingFieldInput,
  MissingFieldResult,
} from '../domain/types';

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
    throw new Error('No JSON found in Gemini response');
  }

  const parsed = JSON.parse(jsonMatch[0]);

  return {
    jobType: parsed.jobType || undefined,
    workPerformed: Array.isArray(parsed.workPerformed) ? parsed.workPerformed : [],
    issuesFound: Array.isArray(parsed.issuesFound) ? parsed.issuesFound : [],
    materials: Array.isArray(parsed.materials)
      ? parsed.materials.map((m: any) => ({
          name: m.name || 'Unknown',
          quantity: m.quantity ?? undefined,
          unit: m.unit ?? undefined,
          estimatedCost: m.estimatedCost ?? undefined,
        }))
      : [],
    durationMinutes: parsed.durationMinutes ?? undefined,
    customerApproved: parsed.customerApproved ?? undefined,
    followUpNotes: Array.isArray(parsed.followUpNotes) ? parsed.followUpNotes : [],
    missingFields: Array.isArray(parsed.missingFields) ? parsed.missingFields : [],
    confidence: parsed.confidence ?? undefined,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CloudAiProvider implements AiProvider {
  private model: GenerativeModel;
  private fallbackModel: GenerativeModel;

  constructor(apiKey: string, modelName = 'gemini-2.0-flash') {
    const genAI = new GoogleGenerativeAI(apiKey);
    this.model = genAI.getGenerativeModel({ model: modelName });
    this.fallbackModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
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
    const prompt = `Summarize this field service job in 2-3 sentences for the customer:

Title: ${input.job.title}
Type: ${input.job.jobType || 'N/A'}
Notes: ${input.notes.map((n) => n.content).join('; ')}
Materials: ${input.materials.map((m) => `${m.quantity} ${m.unit ?? ''} ${m.name}`).join(', ')}
Time: ${input.timeEntries.reduce((s, t) => s + (t.durationMinutes ?? 0), 0)} minutes

Return a JSON object: { "summary": string, "customerVisibleSummary": string }`;

    try {
      await waitForRateLimit();
      const text = await fetchWithTimeout(this.model, prompt, GEMINI_TIMEOUT_MS);
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in summary response');
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary || '',
        customerVisibleSummary: parsed.customerVisibleSummary || parsed.summary || '',
      };
    } catch (error) {
      throw error;
    }
  }

  async suggestMissingFields(input: MissingFieldInput): Promise<MissingFieldResult> {
    return { missingFields: [], suggestions: {} };
  }
}
