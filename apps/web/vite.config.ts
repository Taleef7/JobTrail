import { execSync } from "node:child_process";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function git(cmd: string): string | undefined {
  try {
    return execSync(`git ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

// Build metadata, injected at build time. On Vercel the VERCEL_* vars are set;
// locally we fall back to git so `pnpm build` shows the real commit too.
const build = {
  sha: process.env.VERCEL_GIT_COMMIT_SHA || git("rev-parse HEAD") || "unknown",
  branch: process.env.VERCEL_GIT_COMMIT_REF || git("rev-parse --abbrev-ref HEAD") || "unknown",
  env: process.env.VERCEL_ENV || "local",
  builtAt: new Date().toISOString(),
};

// wllama's multi-threaded WASM needs cross-origin isolation. Production scopes
// these headers to /spike/* (vercel.json); locally they apply to every page.
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD__: JSON.stringify(build),
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        spike: resolve(import.meta.dirname, "spike/index.html"),
        label: resolve(import.meta.dirname, "label/index.html"),
      },
    },
  },
  server: { headers: isolation },
  preview: { headers: isolation },
});
