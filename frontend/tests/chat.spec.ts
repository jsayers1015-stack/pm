import { expect, test } from "@playwright/test";
import { mockChat, signInWithFreshBoard } from "./helpers";

test.describe("chat sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await mockChat(page);
    await signInWithFreshBoard(page);
  });

  test("opens, sends a message, and shows the reply", async ({ page }) => {
    await page.getByTestId("chat-toggle").click();
    await expect(page.getByTestId("chat-sidebar")).toBeVisible();

    await page.getByLabel("Message").fill("How many cards?");
    await page.getByRole("button", { name: /send/i }).click();

    await expect(page.getByTestId("chat-user")).toHaveText("How many cards?");
    await expect(page.getByTestId("chat-assistant")).toHaveText(
      "You have eight cards."
    );
  });

  test("keeps the board usable with the sidebar open", async ({ page }) => {
    await page.getByTestId("chat-toggle").click();
    await expect(page.getByTestId("chat-sidebar")).toBeVisible();

    const firstColumn = page.locator('[data-testid^="column-"]').first();
    await firstColumn.getByRole("button", { name: /add a card/i }).click();
    await firstColumn.getByPlaceholder("Card title").fill("Still works");
    await firstColumn.getByRole("button", { name: /add card/i }).click();

    await expect(firstColumn.getByText("Still works")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  });

  test("is operable from the keyboard", async ({ page }) => {
    await page.getByTestId("chat-toggle").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("chat-sidebar")).toBeVisible();
    await expect(page.getByLabel("Message")).toBeFocused();

    await page.keyboard.type("Hello from the keyboard");
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("chat-user")).toHaveText(
      "Hello from the keyboard"
    );
    await expect(page.getByTestId("chat-assistant")).toBeVisible();

    await page.getByRole("button", { name: /close assistant/i }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("chat-sidebar")).toHaveCount(0);
    await expect(page.getByTestId("chat-toggle")).toBeVisible();
  });
});

test("asks for a card and the board updates without a reload", {
  tag: "@live",
}, async ({ page }) => {
  test.setTimeout(240_000);
  await signInWithFreshBoard(page);

  await page.getByTestId("chat-toggle").click();
  await page
    .getByLabel("Message")
    .fill("Add a card titled 'Book the venue' to the Backlog column.");
  await page.getByRole("button", { name: /send/i }).click();

  await expect(page.getByTestId("chat-thinking")).toBeVisible();
  await expect(page.getByTestId("chat-assistant")).toBeVisible({
    timeout: 200_000,
  });
  await expect(page.getByTestId("chat-board-updated")).toBeVisible();
  await expect(
    page
      .getByTestId("column-col-backlog")
      .getByRole("heading", { name: /book the venue/i })
  ).toBeVisible();
});
