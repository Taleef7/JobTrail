import { expect, it } from "vitest";

// Deliberate failure to prove CI blocks merge (#63). Reverted in the next commit.
it("probe: CI must block merge on a failing test", () => {
  expect(1 + 1).toBe(3);
});
