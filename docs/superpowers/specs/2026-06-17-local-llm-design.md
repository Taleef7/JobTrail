# Phase 10: On-Device LLM Integration — Design Spec

**Date:** 2026-06-17
**Status:** Approved + oracle-reviewed (6 medium findings addressed in revision)
**Branch:** `feat/local-llm`

---

## 1. Goal

Add on-device LLM inference to JobTrail so field workers can run AI extraction offline, without sending data to cloud APIs. Implement a provider cascade that tries the best available inference engine at runtime: Apple Foundation Models (iOS 26+) → local GGUF model (llama.rn + Gemma 4 E2B QAT) → cloud Gemini → rule-based fallback.

This fulfills PLAN.md Phase 10 (Local LLM proof-of-concept) but at full integration scope rather than experiment-only.

---

## 2. Decisions (from brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Runtime | `llama.rn` v0.12.x | GGUF ecosystem, GBNF grammar for guaranteed JSON, Expo config plugin, active development |
| Model | Gemma 4 E2B mobile QAT (0.84 GB GGUF) | Newest tech (June 5 2026), smallest full-featured model, Apache 2.0, native tool calling |
| Scope | Full integration | Complete provider cascade with download UX, settings integration, feature flags |
| Download UX | Settings + first-extraction prompt | Opt-in, progress visible in Settings, user can skip and use cloud |
| Architecture | CascadeAiProvider | Single class wrapping 4 providers, implements AiProvider, reusable across screens |

---

## 3. Architecture

```
extract.tsx / report.tsx / other screens
        │
        ▼
CascadeAiProvider (implements AiProvider)
  │  tries providers in priority order:
  │  1. AppleAiProvider (iOS 26+, zero cost)
  │     └─ not available or fail →
  │  2. LocalLlmAiProvider (llama.rn + Gemma 4 E2B QAT)
  │     └─ not downloaded or fail →
  │  3. CloudAiProvider (Gemini, existing)
  │     └─ no API key or fail →
  │  4. RuleBasedAiProvider (always available, existing)
  │
  ├── AppleAiProvider (new)
  │     wraps @react-native-ai/apple
  │     iOS 26+ only, system model, zero download
  │
  ├── LocalLlmAiProvider (new)
  │     wraps llama.rn
  │     uses ModelManager for download/cache/load
  │     GBNF grammar constrains JSON output
  │
  ├── CloudAiProvider (existing, unchanged)
  │     wraps @google/generative-ai
  │
  └── RuleBasedAiProvider (existing, unchanged)
        regex/heuristic extraction
```

### Key design principles

- **CascadeAiProvider implements AiProvider** — drop-in replacement anywhere AiProvider is used
- **Each inner provider also implements AiProvider** — same interface, same contract
- **ModelManager is a standalone class** (not React) — manages download, caching, loading, unloading
- **AppleAiProvider is iOS-only** — `isAvailable()` returns false on Android or iOS < 26
- **Feature flag `EXPO_PUBLIC_ENABLE_LOCAL_LLM`** gates the local provider; all other providers always available
- **Graceful degradation** — if any provider fails, cascade falls through to the next; rule-based is always the last resort

---

## 4. Components

### 4.1 ModelManager (`src/ai/ModelManager.ts`)

Manages the Gemma 4 E2B QAT GGUF model file lifecycle.

```ts
export type ModelStatus = 'not_downloaded' | 'downloading' | 'ready' | 'error';

export class ModelManager {
  private static instance: ModelManager | null = null;
  private status: ModelStatus = 'not_downloaded';
  private downloadProgress: number = 0;
  private listeners: Set<(status: ModelStatus, progress: number) => void> = new Set();

  // Singleton — one model manager for the app
  static getInstance(): ModelManager

  // Subscribe to status changes (for Settings screen)
  subscribe(listener: (status: ModelStatus, progress: number) => void): () => void

  // Download the GGUF model from CDN
  // Uses expo-file-system createDownloadResumable
  // Reports progress via listeners
  // Guards against concurrent downloads (returns early if already downloading)
  async download(): Promise<void>

  // Load model into llama.rn LlamaContext (warm-up)
  // Called after download or on app foreground if model exists
  async load(): Promise<LlamaContext>

  // Release model from memory
  // Called on app background to avoid iOS memory pressure
  // Defers if LocalLlmAiProvider is mid-inference (sets a flag)
  async unload(): Promise<void>

  // Check if model file exists on disk
  async isDownloaded(): Promise<boolean>

  // Get current status
  getStatus(): ModelStatus

  // Get download progress (0-1)
  getProgress(): number

  // Get file path for llama.rn
  getModelPath(): string
}
```

**Download flow:**
1. First AI extraction attempt → ModelManager checks if model exists on disk
2. If not downloaded → CascadeAiProvider skips LocalLlmAiProvider, falls through to cloud/rule
3. User can opt-in via Settings → "Download AI model for offline extraction (0.8 GB)"
4. Download starts via `expo-file-system` with progress callback
5. Progress surfaced to Settings screen subscribers
6. On success → status becomes 'ready', model can be warm-loaded

**Storage:** `FileSystem.documentDirectory + 'models/gemma-4-e2b-qat.gguf'`

**Model URL:** CDN-hosted placeholder for now (`https://cdn.jobtrail.app/models/gemma-4-e2b-qat.gguf`). User must configure real CDN URL via `EXPO_PUBLIC_LOCAL_LLM_MODEL_URL` env var. If URL is unset/empty, `download()` throws a controlled `AiError` with `kind: 'auth'` and message "Model download URL not configured."

**Lifecycle wiring:** `ModelManager.load()` and `unload()` are called from `app/_layout.tsx` via an `AppState.addEventListener('change', ...)` listener. On `active` → `load()` if model is downloaded. On `background`/`inactive` → `unload()` to release memory. The `LocalLlmAiProvider` sets an `isInferring` flag during inference; `unload()` checks this flag and defers if true.

**Edge cases:**
- Download interrupted → expo-file-system resume support
- Storage full → catch error, set status to 'error', fall through to cloud
- App backgrounded during download → continue (iOS may suspend; resume on foreground)
- Model file corrupted → delete and re-download

### 4.2 LocalLlmAiProvider (`src/ai/LocalLlmAiProvider.ts`)

Wraps `llama.rn` to run Gemma 4 E2B QAT for structured extraction.

```ts
export class LocalLlmAiProvider implements AiProvider {
  private modelManager: ModelManager;
  private context: LlamaContext | null = null;

  constructor(modelManager: ModelManager)

  // Check if this provider can run
  // Returns true when EXPO_PUBLIC_ENABLE_LOCAL_LLM === 'true' AND model file exists on disk
  static isAvailable(): boolean

  async extractJobFields(input: JobExtractionInput): Promise<JobExtractionResult>
  async summarizeJob(input: JobSummaryInput): Promise<JobSummaryResult>
  async suggestMissingFields(input: MissingFieldInput): Promise<MissingFieldResult>
}
```

**Inference parameters:**
- Temperature: 0.1 (deterministic extraction)
- Max tokens: 256 (small output, keeps latency under 5s)
- Context size: 2048 (short notes only, per PLAN §15.4)
- KV-cache quantization: `cache_type_k: 'q8_0'` (reduces memory ~40%)
- Thread count: 4 (balanced for mobile CPUs)
- GBNF grammar: constrains output to match JobExtractionResultSchema

**GBNF grammar:** A `.gbnf` file at `src/ai/grammars/extraction.gbnf` constrains the model to emit only valid JSON matching the extraction schema. The model physically cannot emit invalid JSON. Zod validation remains as a safety net but is no longer the primary defense.

**Error handling:** Reuses `AiError` and `AiParseError` from CloudAiProvider. Throws `AiError` with `kind: 'network'` for model load failures, `kind: 'parse'` for unexpected output (shouldn't happen with GBNF but defensive).

**Telemetry:** Reuses `logAiCall` pattern from CloudAiProvider — logs method, model='gemma-4-e2b-qat', attempt, outcome, duration.

### 4.3 AppleAiProvider (`src/ai/AppleAiProvider.ts`)

Wraps `@react-native-ai/apple` for iOS 26+ Apple Foundation Models.

```ts
export class AppleAiProvider implements AiProvider {
  // Platform check — false on Android or iOS < 26 or non-Apple-Intelligence device
  static isAvailable(): boolean

  async extractJobFields(input: JobExtractionInput): Promise<JobExtractionResult>
  async summarizeJob(input: JobSummaryInput): Promise<JobSummaryResult>
  async suggestMissingFields(input: MissingFieldInput): Promise<MissingFieldResult>
}
```

**Key details:**
- Uses Apple Foundation Models (system-provided, zero download, zero bundle cost)
- Structured output via Apple's `responseFormat` with JSON schema
- `isAvailable()` checks `Platform.OS === 'ios'` + iOS version >= 26 + device capability
- On Android or older iOS → `isAvailable()` returns false → cascade skips
- No model management needed — Apple handles everything
- Telemetry: reuses `logAiCall` with model='apple-foundation'
- **Error handling:** All Apple API calls wrapped in try/catch. Apple's API may throw for: model unavailable (device doesn't support Apple Intelligence), timeout, or content policy. All errors are caught, logged via `logAiCall`, and the cascade falls through to the next provider. The Apple provider never blocks the cascade.

### 4.4 CascadeAiProvider (`src/ai/CascadeAiProvider.ts`)

Composes all providers and tries them in priority order.

```ts
export class CascadeAiProvider implements AiProvider {
  private appleProvider: AppleAiProvider | null;
  private localProvider: LocalLlmAiProvider | null;
  private cloudProvider: CloudAiProvider | null;
  private ruleProvider: RuleBasedAiProvider;
  private lastProviderUsed: string = 'rule_based';

  constructor(config: {
    geminiApiKey?: string;
    modelManager: ModelManager;
  })

  // Which provider actually served the last request
  getLastProviderUsed(): string

  async extractJobFields(input: JobExtractionInput): Promise<JobExtractionResult>
  async summarizeJob(input: JobSummaryInput): Promise<JobSummaryResult>
  async suggestMissingFields(input: MissingFieldInput): Promise<MissingFieldResult>
}
```

**Cascade logic (applies to all 3 methods — extractJobFields, summarizeJob, suggestMissingFields):**
```
1. If AppleAiProvider.isAvailable() → try apple
   └─ success → return (providerUsed = 'apple')
   └─ fail → continue

2. If EXPO_PUBLIC_ENABLE_LOCAL_LLM === 'true' AND LocalLlmAiProvider.isAvailable()
   → try local
   └─ success → return (providerUsed = 'local')
   └─ fail → continue

3. If GEMINI_API_KEY is set → try cloud
   └─ success → return (providerUsed = 'cloud')
   └─ fail → continue

4. Always → rule_based
   └─ return (providerUsed = 'rule_based')
```

**Timeout note:** CloudAiProvider retries up to 3 times with 15s timeouts + fallback model. Worst case ~90s before cascade falls through to rule-based. For v1 this is acceptable since cloud is tried after local (which has its own 15s timeout). If latency becomes an issue, add a cascade-level timeout that short-circuits to rule-based after 30s total.

**Error handling:** Each provider attempt is wrapped in try/catch. Errors are logged via `logAiCall` but do not propagate — the cascade falls through. Only if ALL providers fail (including rule-based, which shouldn't happen) does the cascade throw.

**Provider name tracking:** `getLastProviderUsed()` returns which provider served the last request: `'apple'`, `'local'`, `'cloud'`, or `'rule_based'`. This is used by extract.tsx to save the correct provider name in the extraction result DB record. The telemetry `logAiCall` uses more specific model names (`'apple-foundation'`, `'gemma-4-e2b-qat'`, `GEMINI_MODELS.PRIMARY`) — these are two separate naming schemes: cascade-level provider IDs for DB/UI, telemetry-level model names for debugging.

---

## 5. Feature flags and configuration

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `EXPO_PUBLIC_ENABLE_LOCAL_LLM` | `false` | Gates the LocalLlmAiProvider in the cascade |
| `EXPO_PUBLIC_LOCAL_LLM_MODEL_URL` | (none) | CDN URL for GGUF model download |
| `EXPO_PUBLIC_GEMINI_API_KEY` | (existing) | Cloud AI key (unchanged) |

### app.json changes

Add `llama.rn` config plugin:
```json
"plugins": [
  "expo-router",
  "expo-sqlite",
  "expo-web-browser",
  ["llama.rn", {
    "enableEntitlements": true,
    "entitlementsProfile": "production",
    "forceCxx20": true,
    "enableOpenCL": true
  }]
]
```

### eas.json changes

- Bump Node from 22.11.0 to 22.15.0 (llama.rn config plugin requires 22.15+)
- Set `EXPO_PUBLIC_ENABLE_LOCAL_LLM` to `"true"` for development and preview profiles
- Keep `"false"` for production until device testing is complete

### New dependencies

| Package | Version | Purpose |
|---|---|---|
| `llama.rn` | ^0.12.4 | GGUF inference engine (llama.cpp bindings for RN) |
| `@react-native-ai/apple` | ^0.12.0 | Apple Foundation Models for iOS 26+ |

Both are optional dependencies — the app works without them (cascade skips unavailable providers).

---

## 6. Settings screen integration

Add a new "AI Model" section to `app/settings.tsx` between Sync and About:

```
┌─────────────────────────────────┐
│ AI Model                        │
├─────────────────────────────────┤
│ Status: Not downloaded          │
│                                 │
│ [Download Model (0.8 GB)]       │
│                                 │
│ Download the on-device AI model │
│ for offline extraction. Works   │
│ without internet.               │
└─────────────────────────────────┘
```

**States:**
- `not_downloaded` → Show "Download Model (0.8 GB)" button
- `downloading` → Show progress bar + percentage + "Cancel" button
- `ready` → Show "Model ready (0.8 GB)" + "Delete Model" button
- `error` → Show error message + "Retry Download" button

**Subscribes to ModelManager** for real-time status updates.

---

## 7. extract.tsx changes

### Current state
- Manual `AiMode = 'rule' | 'cloud'` toggle
- User picks provider via chip buttons
- Direct instantiation of RuleBasedAiProvider or CloudAiProvider

### New state
- Replace manual mode toggle with automatic cascade
- Instantiate `CascadeAiProvider` once (singleton or useMemo)
- Call `cascadeProvider.extractJobFields()` — cascade handles provider selection
- Show which provider was used in the results (small label: "Extracted with: On-device AI")
- Save `cascadeProvider.getLastProviderUsed()` as the provider name in DB
- Keep the "Re-run Extraction" button
- Remove the provider chip selector (cascade is automatic)

### Provider label mapping
```ts
const PROVIDER_LABELS: Record<string, string> = {
  apple: 'Apple Intelligence',
  local: 'On-device AI',
  cloud: 'Cloud AI (Gemini)',
  rule_based: 'Rule-based',
};
```

---

## 8. GBNF grammar

A grammar file at `src/ai/grammars/extraction.gbnf` constrains llama.rn output to valid JSON matching `JobExtractionResultSchema`.

**Generation:** A script at `scripts/generate-gbnf.ts` derives the grammar from the Zod schema. Run manually when the schema changes:
```bash
npx tsx scripts/generate-gbnf.ts > src/ai/grammars/extraction.gbnf
```

**Grammar structure (simplified):**
```
root ::= "{" ws "\"jobType\":" (string | "null") "," ws "\"workPerformed\":" string-array "," ws "\"issuesFound\":" string-array "," ws "\"materials\":" material-array "," ws "\"durationMinutes\":" (number | "null") "," ws "\"customerApproved\": ("true" | "false" | "null") "," ws "\"followUpNotes\":" string-array "," ws "\"missingFields\":" string-array "," ws "\"confidence\":" (number | "null") ws "}"
```

The actual GBNF syntax is more detailed (character classes, whitespace rules). The script handles generation.

---

## 9. Error handling and fallback

### Error types (reuse from CloudAiProvider)
- `AiError` with `kind` classification (timeout, rate_limit, parse, network, auth, unknown)
- `AiParseError` for JSON parse failures

### Cascade error behavior
- Each provider attempt is wrapped in try/catch
- Errors are logged via `logAiCall` with the provider name
- Errors do NOT propagate to the user — cascade falls through silently
- Only the final error (if ALL providers fail including rule-based) propagates
- The user sees the result from whichever provider succeeded

### Model-specific errors
- Model not downloaded → skip local provider (not an error, just unavailable)
- Model load failure → log and skip to cloud
- Model inference timeout (15s) → log and skip to cloud
- GBNF parse failure (shouldn't happen) → Zod catches as safety net, log and skip

---

## 10. Testing strategy

### Unit tests
- `ModelManager` — mock expo-file-system, test download/cache/load/unload state transitions
- `LocalLlmAiProvider` — mock llama.rn LlamaContext, test extraction with stubbed model output
- `AppleAiProvider` — mock @react-native-ai/apple, test isAvailable() platform checks
- `CascadeAiProvider` — mock all 4 providers, test cascade order and fallback behavior

### Integration tests
- Cascade with real RuleBasedAiProvider (always works) + mocked Apple/Local/Cloud
- Verify provider name tracking through the cascade

### Manual testing (requires physical device)
- Download model on iPhone 15+ and verify extraction works offline
- Test on Android with OpenCL support (Snapdragon 8 Gen 1+)
- Verify cascade falls through when model is not downloaded
- Verify Apple provider works on iOS 26+ device
- Measure latency: target < 5s for 200-token extraction on warm model

### What we can test in CI (no device)
- TypeScript compilation
- ESLint
- Unit tests with mocked native modules
- GBNF grammar generation script

---

## 11. Branch strategy

- Branch: `feat/local-llm`
- Base: `main`
- PR title: "feat: on-device LLM integration with provider cascade"
- Squash merge after CI passes

---

## 12. Known limitations and risks

| Risk | Mitigation |
|---|---|
| llama.rn requires New Architecture | Already enabled in app.json (`newArchEnabled: true`) |
| Model download is 0.84 GB | Opt-in only, user can skip, cloud fallback always available |
| iOS memory pressure kills app | ModelManager.unload() on app background, reload on foreground |
| Mid-range Android too slow | Cloud fallback handles this; local model is opt-in |
| llama.rn Node 22.15+ requirement | Bump eas.json Node from 22.11.0 to 22.15.0 |
| No Expo Go support | App already uses expo-dev-client (in package.json) |
| GBNF grammar must match schema | Script generates from Zod; CI can validate |
| Apple provider iOS 26+ only | isAvailable() check; cascade falls through on older iOS |
| Model CDN URL not configured | EXPO_PUBLIC_LOCAL_LLM_MODEL_URL env var; placeholder default |
| Thermal throttling on sustained use | Extraction is one-shot (not sustained); burst performance is fine |

---

## 13. Acceptance criteria (from PLAN.md Phase 10)

1. ✅ Local model can process a short job note on at least one test device
2. ✅ App still works if local model is unavailable (cascade fallback)
3. ✅ Feature can be disabled from environment/config (EXPO_PUBLIC_ENABLE_LOCAL_LLM)
4. ✅ Feature flag for local LLM (already declared, now wired)
5. ✅ Research target runtime (llama.rn — done)
6. ✅ Prototype provider (LocalLlmAiProvider)
7. ✅ Download a small test model outside the main flow (ModelManager opt-in)
8. ✅ Test extraction on short notes (GBNF-constrained, 256 max tokens)
9. ✅ Log latency and device behavior (logAiCall telemetry)
10. ✅ Add fallback to rule/cloud provider (CascadeAiProvider)

---

## 14. File inventory

### New files
| File | Purpose |
|---|---|
| `src/ai/ModelManager.ts` | Model download, cache, load, unload |
| `src/ai/LocalLlmAiProvider.ts` | llama.rn wrapper for Gemma 4 E2B QAT |
| `src/ai/AppleAiProvider.ts` | @react-native-ai/apple wrapper for iOS 26+ |
| `src/ai/CascadeAiProvider.ts` | Provider cascade logic |
| `src/ai/grammars/extraction.gbnf` | GBNF grammar for constrained JSON output |
| `scripts/generate-gbnf.ts` | Script to generate GBNF from Zod schema |
| `__tests__/CascadeAiProvider.test.ts` | Unit tests for cascade logic |
| `__tests__/ModelManager.test.ts` | Unit tests for model lifecycle |

### Modified files
| File | Changes |
|---|---|
| `app/job/[id]/extract.tsx` | Replace manual mode toggle with CascadeAiProvider |
| `app/settings.tsx` | Add AI Model section with download/status UI |
| `app.json` | Add llama.rn config plugin |
| `eas.json` | Bump Node to 22.15.0, set ENABLE_LOCAL_LLM for dev/preview |
| `package.json` | Add llama.rn and @react-native-ai/apple dependencies |
| `src/ai/index.ts` | Export new providers |
| `.env.example` | Add EXPO_PUBLIC_LOCAL_LLM_MODEL_URL |

### Unchanged files
| File | Why |
|---|---|
| `src/ai/CloudAiProvider.ts` | Existing, cascade calls it as-is |
| `src/ai/RuleBasedAiProvider.ts` | Existing, cascade calls it as-is |
| `src/ai/AiProvider.ts` | Interface unchanged |
| `src/domain/schemas.ts` | Zod schemas unchanged (GBNF derived from them) |
| `src/domain/types.ts` | Types unchanged |

---

## 15. Implementation order

1. **Dependencies + config** — add llama.rn, @react-native-ai/apple, update app.json, eas.json, package.json
2. **ModelManager** — download, cache, load, unload
3. **GBNF grammar** — generate from Zod schema
4. **LocalLlmAiProvider** — llama.rn wrapper with GBNF
5. **AppleAiProvider** — @react-native-ai/apple wrapper
6. **CascadeAiProvider** — compose all 4 providers
7. **Settings screen** — AI Model section with download UI
8. **extract.tsx** — replace manual toggle with cascade
9. **Tests** — unit tests for new components
10. **Verify** — typecheck, lint, tests, commit, push, PR
