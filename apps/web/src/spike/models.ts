// Models the spike can benchmark. Sizes are the download size in MB (10^6 bytes).
// #110 adds two small candidates found by research: LFM2-350M-Extract (built for
// structured extraction) and SmolLM2-135M (the smallest usable model). Defaults cover
// what hasn't been measured on phones yet, plus the Gemma Q8 reference.

export interface ModelSpec {
  id: string;
  repo: string;
  file: string;
  sizeMB: number;
  defaultOn: boolean;
}

export const MODELS: ModelSpec[] = [
  {
    id: "gemma3-270m-q8_0",
    repo: "unsloth/gemma-3-270m-it-GGUF",
    file: "gemma-3-270m-it-Q8_0.gguf",
    sizeMB: 292,
    defaultOn: true,
  },
  {
    id: "gemma3-270m-q4_0",
    repo: "unsloth/gemma-3-270m-it-GGUF",
    file: "gemma-3-270m-it-Q4_0.gguf",
    sizeMB: 242,
    defaultOn: false,
  },
  {
    id: "lfm2-350m-extract-q8_0",
    repo: "LiquidAI/LFM2-350M-Extract-GGUF",
    file: "LFM2-350M-Extract-Q8_0.gguf",
    sizeMB: 380,
    defaultOn: true,
  },
  {
    id: "lfm2-350m-extract-q4_0",
    repo: "LiquidAI/LFM2-350M-Extract-GGUF",
    file: "LFM2-350M-Extract-Q4_0.gguf",
    sizeMB: 219,
    defaultOn: false,
  },
  {
    id: "smollm2-135m-q8_0",
    repo: "bartowski/SmolLM2-135M-Instruct-GGUF",
    file: "SmolLM2-135M-Instruct-Q8_0.gguf",
    sizeMB: 145,
    defaultOn: true,
  },
  {
    id: "qwen3-0.6b-q4_k_m",
    repo: "unsloth/Qwen3-0.6B-GGUF",
    file: "Qwen3-0.6B-Q4_K_M.gguf",
    sizeMB: 397,
    defaultOn: false,
  },
];

/**
 * The URL wllama's loadModelFromHF() resolves to and caches under. Downloading this
 * exact URL with wllama's ModelManager pre-fills the same cache, so a later Run is a
 * cache hit (#110: on iPhone, running right after a download can exceed the tab's
 * memory, while the same model run from cache succeeds).
 */
export const hfUrl = (m: Pick<ModelSpec, "repo" | "file">) =>
  `https://huggingface.co/${m.repo}/resolve/main/${m.file}`;
