import { File, Directory, Paths } from 'expo-file-system';

export type ModelStatus = 'not_downloaded' | 'downloading' | 'ready' | 'error';

/**
 * Singleton manager for the Gemma 4 E2B QAT GGUF model file lifecycle.
 * Handles download tracking, progress subscription, and file-system operations.
 */
export class ModelManager {
  private static instance: ModelManager | null = null;
  private status: ModelStatus = 'not_downloaded';
  private downloadProgress: number = 0;
  private listeners: Set<(status: ModelStatus, progress: number) => void> = new Set();

  static getInstance(): ModelManager {
    if (!ModelManager.instance) {
      ModelManager.instance = new ModelManager();
    }
    return ModelManager.instance;
  }

  subscribe(listener: (status: ModelStatus, progress: number) => void): () => void {
    this.listeners.add(listener);
    listener(this.status, this.downloadProgress);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach(l => l(this.status, this.downloadProgress));
  }

  getStatus(): ModelStatus { return this.status; }
  getProgress(): number { return this.downloadProgress; }

  /** Resolve the full path to the model file. */
  getModelPath(): string {
    return new File(Paths.document, 'models', 'gemma-4-e2b-qat.gguf').uri;
  }

  /** Check whether the model file already exists on disk. */
  async isDownloaded(): Promise<boolean> {
    const modelFile = new File(Paths.document, 'models', 'gemma-4-e2b-qat.gguf');
    return modelFile.exists;
  }

  /** Download the model from the configured URL. */
  async download(): Promise<void> {
    if (this.status === 'downloading') return;

    const modelUrl = process.env.EXPO_PUBLIC_LOCAL_LLM_MODEL_URL;
    if (!modelUrl) {
      throw new Error('Model download URL not configured. Set EXPO_PUBLIC_LOCAL_LLM_MODEL_URL in .env');
    }

    // Ensure the models directory exists
    const modelsDir = new Directory(Paths.document, 'models');
    if (!modelsDir.exists) {
      modelsDir.create({ intermediates: true });
    }

    this.status = 'downloading';
    this.downloadProgress = 0;
    this.notifyListeners();

    try {
      await File.downloadFileAsync(modelUrl, modelsDir);
      this.status = 'ready';
      this.downloadProgress = 1;
      this.notifyListeners();
    } catch (error) {
      this.status = 'error';
      this.notifyListeners();
      throw error;
    }
  }

  /** Remove the downloaded model file from disk. */
  async deleteModel(): Promise<void> {
    try {
      const modelFile = new File(Paths.document, 'models', 'gemma-4-e2b-qat.gguf');
      if (modelFile.exists) {
        modelFile.delete();
      }
    } catch { /* ignore */ }
    this.status = 'not_downloaded';
    this.downloadProgress = 0;
    this.notifyListeners();
  }

  /** Probe file-system on app start to determine current state. */
  async initialize(): Promise<void> {
    const downloaded = await this.isDownloaded();
    this.status = downloaded ? 'ready' : 'not_downloaded';
    this.notifyListeners();
  }
}
