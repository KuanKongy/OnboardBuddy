import { expect, test } from "@playwright/test";

test.describe("docker stack smoke", () => {
  test("frontend serves the landing page", async ({ request }) => {
    const res = await request.get("http://localhost:5173/");
    expect(res.ok()).toBeTruthy();
    const html = await res.text();
    expect(html).toContain("OnboardBuddy");
  });

  test("backend health endpoint responds", async ({ request }) => {
    const res = await request.get("http://localhost:3000/api/health");
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { status?: string };
    expect(body.status).toBe("ok");
  });
});
