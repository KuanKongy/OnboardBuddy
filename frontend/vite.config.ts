import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    // Dev-only: lets a local `vite` session run against the compose API from
    // any port (the API's CORS allowlist pins http://localhost:5173, which
    // the docker frontend owns). Start with VITE_API_URL=/api to use it —
    // requests become same-origin and CORS never applies. No effect on builds.
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["vitest.setup.ts", "src/test/setup.ts"],
    // The one-command Docker run gives the whole suite one CPU-constrained container. The
    // defaults (5s per test, 1s per waitFor — see vitest.setup.ts) were tight enough there that
    // specs which pass standalone failed intermittently on timing alone. Kept above the
    // Testing Library async budget so a slow render is reported by the query, not by this.
    testTimeout: 20000,
    hookTimeout: 20000,
    // Vitest defaults to one worker per core. In the test container that is 9 forks, each
    // running jsdom + React + reactflow inside a shared 8 GB — enough contention that renders
    // missed their deadline and the one-command run failed on timing rather than on a defect.
    // 21 test files do not need more than this, and the suite is no slower for it.
    maxWorkers: 4,
    css: true
  }
});
