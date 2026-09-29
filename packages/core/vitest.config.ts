import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // core has no logic until the schema lands (#67); remove this then.
    passWithNoTests: true,
  },
});
