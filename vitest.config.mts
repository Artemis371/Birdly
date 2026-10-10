import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
  // In-memory Postgres tests are slow when several files run in parallel. The
  // first freshDb() in each file runs every migration (src/test/db.ts), which
  // measured 6-8s with 4 workers and ~16s on a cold run, and it runs inside a
  // beforeEach. Hooks have their own timeout (10s by default, separate from
  // testTimeout), which made those files fail intermittently. 60s leaves room.
  test: { include: ["src/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 60_000 },
});
