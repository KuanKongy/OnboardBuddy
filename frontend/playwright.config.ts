import { defineConfig, devices } from "@playwright/test";

const useDockerStack = process.env.USE_DOCKER_STACK === "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "html",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry"
  },
  webServer: useDockerStack
    ? undefined
    : {
        command: "npm run dev -w frontend -- --host 127.0.0.1",
        url: "http://127.0.0.1:5173",
        reuseExistingServer: !process.env.CI
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
