import { expect, type Page } from "@playwright/test";
import { initialData } from "../src/lib/kanban";

export const signIn = async (page: Page) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
};

// Saves are debounced, so a test that reloads has to wait for the write to land
// first. Call this before the action that triggers the save.
export const waitForBoardSave = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.url().includes("/api/board") &&
      response.request().method() === "PUT" &&
      response.ok()
  );

// Board changes now persist, so every test that mutates the board has to start
// from a known state. page.request shares the signed-in cookie jar.
export const signInWithFreshBoard = async (page: Page) => {
  await signIn(page);
  const response = await page.request.put("/api/board", { data: initialData });
  expect(response.ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
};

export const mockChat = async (
  page: Page,
  reply = { reply: "You have eight cards.", board_updated: false }
) => {
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: reply,
    })
  );
};
