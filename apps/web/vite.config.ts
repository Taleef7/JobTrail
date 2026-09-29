import { execSync } from "node:child_process";
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

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD__: JSON.stringify(build),
  },
});
