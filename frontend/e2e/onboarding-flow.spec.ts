import { expect, test } from "@playwright/test";

test.describe("onboarding flow", () => {
  test.skip("signup -> import repo -> run analysis -> view package -> walkthrough -> export", async ({
    page
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  });
});
