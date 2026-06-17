import type {
  JobExtractionInput,
  JobExtractionResult,
  JobSummaryInput,
  JobSummaryResult,
  MissingFieldInput,
  MissingFieldResult,
} from '../domain/types';
import type { AiProvider } from './AiProvider';
import { AiError, CloudAiProvider } from './CloudAiProvider';
import { AppleAiProvider } from './AppleAiProvider';
import { LocalLlmAiProvider } from './LocalLlmAiProvider';
import { RuleBasedAiProvider } from './RuleBasedAiProvider';
import { ModelManager } from './ModelManager';

interface CascadeOptions {
  geminiApiKey?: string;
  modelManager?: ModelManager;
}

/**
 * CascadeAiProvider composes all four providers and tries each in priority
 * order: Apple Foundation Models -> local LLM (llama.rn) -> cloud Gemini ->
 * rule-based fallback. If Apple or local LLM are unavailable they are skipped.
 * The rule-based provider always succeeds, so this provider should never
 * throw under normal circumstances.
 */
export class CascadeAiProvider implements AiProvider {
  private appleProvider: AppleAiProvider;
  private localProvider: LocalLlmAiProvider;
  private cloudProvider: CloudAiProvider | null = null;
  private ruleProvider: RuleBasedAiProvider;

  /** Name of the provider that served the most recent request. */
  private lastProviderUsed: string = 'none';

  /** Returns which provider served the most recent request. */
  getLastProviderUsed(): string {
    return this.lastProviderUsed;
  }

  constructor(options: CascadeOptions = {}) {
    this.appleProvider = new AppleAiProvider();
    this.localProvider = new LocalLlmAiProvider();
    this.ruleProvider = new RuleBasedAiProvider();

    if (options.geminiApiKey) {
      this.cloudProvider = new CloudAiProvider(options.geminiApiKey);
    }
  }

  async extractJobFields(input: JobExtractionInput): Promise<JobExtractionResult> {
    const providers: { name: string; available: boolean; call: () => Promise<JobExtractionResult> }[] = [
      {
        name: 'apple-foundation',
        available: AppleAiProvider.isAvailable(),
        call: () => this.appleProvider.extractJobFields(input),
      },
      {
        name: 'local-llm',
        available: LocalLlmAiProvider.isAvailable(),
        call: () => this.localProvider.extractJobFields(input),
      },
      {
        name: 'cloud',
        available: this.cloudProvider !== null,
        call: () => this.cloudProvider!.extractJobFields(input),
      },
      {
        name: 'rule-based',
        available: true,
        call: () => this.ruleProvider.extractJobFields(input),
      },
    ];

    for (const provider of providers) {
      if (!provider.available) continue;
      try {
        const result = await provider.call();
        this.lastProviderUsed = provider.name;
        return result;
      } catch (err) {
        // Log and try next provider in the cascade
        if (__DEV__) {
          console.log(`[CascadeAiProvider] ${provider.name} failed, trying next:`, err);
        }
      }
    }

    throw new AiError('All AI providers failed', 'unknown');
  }

  async summarizeJob(input: JobSummaryInput): Promise<JobSummaryResult> {
    const providers: { name: string; available: boolean; call: () => Promise<JobSummaryResult> }[] = [
      {
        name: 'apple-foundation',
        available: AppleAiProvider.isAvailable(),
        call: () => this.appleProvider.summarizeJob(input),
      },
      {
        name: 'local-llm',
        available: LocalLlmAiProvider.isAvailable(),
        call: () => this.localProvider.summarizeJob(input),
      },
      {
        name: 'cloud',
        available: this.cloudProvider !== null,
        call: () => this.cloudProvider!.summarizeJob(input),
      },
      {
        name: 'rule-based',
        available: true,
        call: () => this.ruleProvider.summarizeJob(input),
      },
    ];

    for (const provider of providers) {
      if (!provider.available) continue;
      try {
        const result = await provider.call();
        this.lastProviderUsed = provider.name;
        return result;
      } catch (err) {
        if (__DEV__) {
          console.log(`[CascadeAiProvider] ${provider.name} failed, trying next:`, err);
        }
      }
    }

    throw new AiError('All AI providers failed', 'unknown');
  }

  async suggestMissingFields(input: MissingFieldInput): Promise<MissingFieldResult> {
    const providers: { name: string; available: boolean; call: () => Promise<MissingFieldResult> }[] = [
      {
        name: 'apple-foundation',
        available: AppleAiProvider.isAvailable(),
        call: () => this.appleProvider.suggestMissingFields(input),
      },
      {
        name: 'local-llm',
        available: LocalLlmAiProvider.isAvailable(),
        call: () => this.localProvider.suggestMissingFields(input),
      },
      {
        name: 'cloud',
        available: this.cloudProvider !== null,
        call: () => this.cloudProvider!.suggestMissingFields(input),
      },
      {
        name: 'rule-based',
        available: true,
        call: () => this.ruleProvider.suggestMissingFields(input),
      },
    ];

    for (const provider of providers) {
      if (!provider.available) continue;
      try {
        const result = await provider.call();
        this.lastProviderUsed = provider.name;
        return result;
      } catch (err) {
        if (__DEV__) {
          console.log(`[CascadeAiProvider] ${provider.name} failed, trying next:`, err);
        }
      }
    }

    throw new AiError('All AI providers failed', 'unknown');
  }
}
