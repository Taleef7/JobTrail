// Vitest exposes Vite's import.meta.env (used for `--mode update-schemas`).
interface ImportMeta {
  readonly env: { readonly MODE: string };
}
