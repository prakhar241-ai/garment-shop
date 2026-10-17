import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    // Loads .env.local so the database tests can reach Supabase; they skip
    // themselves when it is missing.
    env: loadEnv("test", process.cwd(), ""),
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 20_000,
    // The database test files share test shop B; run them one after another.
    fileParallelism: false,
  },
});
