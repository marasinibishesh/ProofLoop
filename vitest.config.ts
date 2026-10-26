import { defineConfig } from "vitest/config";

// Only Proofloop's own tests. The vendored engines have their own suites (run them inside vendor/*).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
