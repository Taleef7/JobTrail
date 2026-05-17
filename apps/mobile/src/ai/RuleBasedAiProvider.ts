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
 * RuleBasedAiProvider uses pattern matching and heuristics to extract
 * structured fields from rough text notes. No external API or LLM needed.
 */
export class RuleBasedAiProvider implements AiProvider {
  async extractJobFields(input: JobExtractionInput): Promise<JobExtractionResult> {
    const text = input.noteText.toLowerCase();
    const result: JobExtractionResult = {
      workPerformed: [],
      issuesFound: [],
      materials: [],
      followUpNotes: [],
      missingFields: [],
    };

    // --- Extract job type ---
    const jobTypes: Record<string, string[]> = {
      plumbing: ['plumb', 'pipe', 'sink', 'drain', 'faucet', 'toilet', 'p-trap', 'pvc'],
      electrical: ['electr', 'wiring', 'outlet', 'switch', 'circuit', 'breaker', 'light'],
      hvac: ['hvac', 'air condition', 'furnace', 'heater', 'duct', 'vent', 'thermostat'],
      cleaning: ['clean', 'wash', 'sanitize', 'dust', 'mop', 'vacuum'],
      inspection: ['inspect', 'inspect', 'assess', 'check', 'evaluate', 'audit'],
      general: ['repair', 'fix', 'replace', 'install', 'maintain'],
    };

    for (const [type, keywords] of Object.entries(jobTypes)) {
      if (keywords.some((kw) => text.includes(kw))) {
        result.jobType = type;
        break;
      }
    }

    // --- Extract work performed ---
    // Look for action verbs + objects
    const workPatterns = [
      /(?:replaced|fixed|repaired|installed|removed|adjusted|cleaned|checked|inspected)\s+([^.,\n]+)/gi,
    ];
    for (const pattern of workPatterns) {
      let match;
      while ((match = pattern.exec(input.noteText)) !== null) {
        const work = match[1].trim();
        if (work && !result.workPerformed.includes(work)) {
          result.workPerformed.push(capitalize(work));
        }
      }
    }

    // --- Extract materials ---
    // Pattern: "used/used one/used X <quantity> <material>"
    const materialPatterns = [
      /used\s+(?:(\d+)\s+)?([^.,\n]{3,40}?)(?:\s*,|\s*\.|\s*and|$)/gi,
      /(\d+)\s+([A-Za-z\s]{3,30}?\s(?:kit|piece|unit|pack|roll|box|bag|set|bottle|tube|can))/gi,
    ];

    for (const pattern of materialPatterns) {
      let match;
      while ((match = pattern.exec(input.noteText)) !== null) {
        if (pattern === materialPatterns[0]) {
          const quantity = match[1] ? parseInt(match[1], 10) : 1;
          const name = match[2].trim().replace(/^(one|two|three|four|five)\s+/i, '').trim();
          if (name.length > 2 && !result.materials.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
            result.materials.push({ name: capitalize(name), quantity, unit: inferUnit(name) });
          }
        } else {
          const quantity = parseInt(match[1], 10);
          const name = match[2].trim();
          if (!result.materials.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
            result.materials.push({ name: capitalize(name), quantity, unit: inferUnit(name) });
          }
        }
      }
    }

    // --- Extract duration ---
    const durationPatterns = [
      /took\s+(\d+)\s*(?:minutes?|mins?|min)/i,
      /(\d+)\s*(?:minutes?|mins?|min)\s*(?:of\s+)?(?:work|labor)/i,
      /(?:spent|took|worked)\s+(?:about\s+)?(\d+)\s*(?:minutes?|mins?|min)/i,
      /(\d+)\s*(?:minutes?|mins?|min)/i,
    ];

    for (const pattern of durationPatterns) {
      const match = pattern.exec(input.noteText);
      if (match) {
        result.durationMinutes = parseInt(match[1], 10);
        break;
      }
    }

    // --- Extract customer approval ---
    if (/customer\s*(approved|ok|okay|signed off|accepted|confirmed)/i.test(text)) {
      result.customerApproved = true;
    } else if (/customer\s*(denied|rejected|not approved|refused)/i.test(text)) {
      result.customerApproved = false;
    }

    // --- Extract follow-up notes ---
    const followUpPatterns = [
      /follow[\s-]?up\s*(?:if|when|in case|should|to|on|for)?\s*([^.,\n]+)/gi,
      /check\s+(?:back|if|whether|on)\s+([^.,\n]+)/gi,
      /monitor\s+(?:for|if|whether)\s+([^.,\n]+)/gi,
    ];

    for (const pattern of followUpPatterns) {
      let match;
      while ((match = pattern.exec(input.noteText)) !== null) {
        const note = match[0].trim();
        if (note && !result.followUpNotes.includes(note)) {
          result.followUpNotes.push(capitalize(note));
        }
      }
    }

    // --- Compute confidence ---
    let confidence = 0.3;
    if (result.workPerformed.length > 0) confidence += 0.15;
    if (result.materials.length > 0) confidence += 0.15;
    if (result.durationMinutes !== undefined) confidence += 0.15;
    if (result.customerApproved !== undefined) confidence += 0.1;
    if (result.followUpNotes.length > 0) confidence += 0.05;
    if (result.jobType) confidence += 0.1;
    result.confidence = Math.min(confidence, 1);

    // --- Identify missing fields ---
    if (result.materials.length === 0) result.missingFields.push('materials');
    if (result.durationMinutes === undefined) result.missingFields.push('durationMinutes');
    if (result.customerApproved === undefined) result.missingFields.push('customerApproval');

    return result;
  }

  async summarizeJob(input: JobSummaryInput): Promise<JobSummaryResult> {
    const { job, notes, materials, timeEntries } = input;

    const workSummary = notes.map((n) => n.content).join('; ') || 'No notes recorded.';
    const materialsSummary = materials.length > 0
      ? materials.map((m) => `${m.quantity} ${m.unit ?? ''} ${m.name}`.trim()).join(', ')
      : 'No materials recorded.';
    const totalMinutes = timeEntries.reduce((sum, t) => sum + (t.durationMinutes ?? 0), 0);
    const laborSummary = totalMinutes > 0 ? `${totalMinutes} minutes` : 'No labor time recorded.';

    const summary = `Job: ${job.title}\nWork: ${workSummary}\nMaterials: ${materialsSummary}\nLabor: ${laborSummary}`;

    const customerVisibleSummary = `Work completed on "${job.title}". ${workSummary} Materials used: ${materialsSummary}. Total labor: ${laborSummary}.`;

    return { summary, customerVisibleSummary };
  }

  async suggestMissingFields(input: MissingFieldInput): Promise<MissingFieldResult> {
    const missing: string[] = [];
    const suggestions: Record<string, string> = {};

    if (input.materials.length === 0) {
      missing.push('materials');
      suggestions['materials'] = 'No materials recorded. Consider adding materials used on this job.';
    }
    if (input.timeEntries.length === 0) {
      missing.push('timeEntries');
      suggestions['timeEntries'] = 'No time entries recorded. Consider adding labor time.';
    }
    if (!input.job.customerVisibleSummary && !input.job.structuredSummary) {
      missing.push('summary');
      suggestions['summary'] = 'No summary generated. Consider running AI extraction on your notes.';
    }

    return { missingFields: missing, suggestions };
  }
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function inferUnit(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (lower.includes('kit')) return 'kit';
  if (lower.includes('piece')) return 'piece';
  if (lower.includes('pack')) return 'pack';
  if (lower.includes('roll')) return 'roll';
  if (lower.includes('box')) return 'box';
  if (lower.includes('bag')) return 'bag';
  if (lower.includes('bottle')) return 'bottle';
  if (lower.includes('tube')) return 'tube';
  if (lower.includes('can')) return 'can';
  if (lower.includes('set')) return 'set';
  return undefined;
}