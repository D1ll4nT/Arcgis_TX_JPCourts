import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/smoke/**/*.smoke.test.ts"],
    environment: "node",
    testTimeout: 30_000,
  },
});
