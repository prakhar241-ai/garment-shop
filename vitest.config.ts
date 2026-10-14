import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig({
  test: {
    // Loads .env.local so the database tests can reach Supabase; they skip
    // themselves when it is missing.
    env: loadEnv("test", process.cwd(), ""),
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
