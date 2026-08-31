import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("shows the login form instead of the board when not signed in", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toHaveCount(0);
});

test("rejects wrong credentials with an error", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: /sign in/i }).click();

  // Not getByRole("alert"): NextJS injects a route announcer with the same role.
  await expect(page.getByTestId("login-error")).toContainText(/incorrect/i);
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toHaveCount(0);
});

test("signs in with the expected credentials", async ({ page }) => {
  await signIn(page);
  await expect(page.getByText(/signed in as user/i)).toBeVisible();
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
});

test("keeps the session across a reload", async ({ page }) => {
  await signIn(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in" })).toHaveCount(0);
});

test("signs out and returns to the login form", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: /sign out/i }).click();

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toHaveCount(0);
});

test("does not restore the board after signing out and reloading", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("button", { name: /sign out/i }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("protects the API, not just the UI", async ({ request }) => {
  const response = await request.get("/api/me");
  expect(response.status()).toBe(401);
});
