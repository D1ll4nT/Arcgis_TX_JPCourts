import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/smoke/**"],
    environment: "node",
    // Task 1 ends with no test files (the sanity test is removed); later tasks
    // and filtered runs must not fail merely because a glob matched nothing.
    passWithNoTests: true,
  },
});
