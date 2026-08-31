import { expect, test, type Page } from "@playwright/test";
import { signIn, signInWithFreshBoard, waitForBoardSave } from "./helpers";

const dragTo = async (
  page: Page,
  cardTestId: string,
  columnTestId: string
) => {
  const card = page.getByTestId(cardTestId);
  const targetColumn = page.getByTestId(columnTestId);
  const cardBox = await card.boundingBox();
  const columnBox = await targetColumn.boundingBox();
  if (!cardBox || !columnBox) {
    throw new Error("Unable to resolve drag coordinates.");
  }

  await page.mouse.move(
    cardBox.x + cardBox.width / 2,
    cardBox.y + cardBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(columnBox.x + columnBox.width / 2, columnBox.y + 120, {
    steps: 12,
  });
  await page.mouse.up();
};

test.beforeEach(async ({ page }) => {
  await signInWithFreshBoard(page);
});

test("loads the kanban board", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
});

test("adds a card to a column", async ({ page }) => {
  const firstColumn = page.locator('[data-testid^="column-"]').first();
  await firstColumn.getByRole("button", { name: /add a card/i }).click();
  await firstColumn.getByPlaceholder("Card title").fill("Playwright card");
  await firstColumn.getByPlaceholder("Details").fill("Added via e2e.");
  await firstColumn.getByRole("button", { name: /add card/i }).click();
  await expect(firstColumn.getByText("Playwright card")).toBeVisible();
});

test("edits a card", async ({ page }) => {
  const card = page.getByTestId("card-card-1");

  await card.getByRole("button", { name: /edit align roadmap themes/i }).click();
  await card.getByLabel("Edit title").fill("Edited by e2e");
  await card.getByLabel("Edit details").fill("New details from e2e.");
  await card.getByRole("button", { name: /save/i }).click();

  await expect(card.getByText("Edited by e2e")).toBeVisible();
  await expect(card.getByText("New details from e2e.")).toBeVisible();
});

test("discards a card edit", async ({ page }) => {
  const card = page.getByTestId("card-card-2");

  await card.getByRole("button", { name: /edit gather customer signals/i }).click();
  await card.getByLabel("Edit title").fill("Should not persist");
  await card.getByRole("button", { name: /discard/i }).click();

  await expect(card.getByText("Gather customer signals")).toBeVisible();
  await expect(card.getByText("Should not persist")).toHaveCount(0);
});

test("moves a card between columns", async ({ page }) => {
  await dragTo(page, "card-card-1", "column-col-review");
  await expect(
    page.getByTestId("column-col-review").getByTestId("card-card-1")
  ).toBeVisible();
});

// Guards against the edit form's inputs permanently stealing the drag listeners.
test("still drags a card after editing it", async ({ page }) => {
  const card = page.getByTestId("card-card-1");

  await card.getByRole("button", { name: /edit align roadmap themes/i }).click();
  await card.getByLabel("Edit title").fill("Edited then dragged");
  await card.getByRole("button", { name: /save/i }).click();
  await expect(card.getByText("Edited then dragged")).toBeVisible();

  await dragTo(page, "card-card-1", "column-col-done");
  await expect(
    page.getByTestId("column-col-done").getByTestId("card-card-1")
  ).toBeVisible();
});

test("keeps an added card after a reload", async ({ page }) => {
  const firstColumn = page.locator('[data-testid^="column-"]').first();
  await firstColumn.getByRole("button", { name: /add a card/i }).click();
  await firstColumn.getByPlaceholder("Card title").fill("Survives reload");
  await firstColumn.getByPlaceholder("Details").fill("Written to SQLite.");

  const saved = waitForBoardSave(page);
  await firstColumn.getByRole("button", { name: /add card/i }).click();
  await saved;

  await page.reload();
  await expect(
    page.locator('[data-testid^="column-"]').first().getByText("Survives reload")
  ).toBeVisible();
  await expect(page.getByText("Written to SQLite.")).toBeVisible();
});

test("keeps a removed card after a reload", async ({ page }) => {
  const saved = waitForBoardSave(page);
  await page
    .getByTestId("card-card-1")
    .getByRole("button", { name: /delete align roadmap themes/i })
    .click();
  await saved;

  await page.reload();
  await expect(page.getByTestId("card-card-1")).toHaveCount(0);
});

test("keeps an edited card after a reload", async ({ page }) => {
  const card = page.getByTestId("card-card-1");
  await card.getByRole("button", { name: /edit align roadmap themes/i }).click();
  await card.getByLabel("Edit title").fill("Edit survives reload");

  const saved = waitForBoardSave(page);
  await card.getByRole("button", { name: /save/i }).click();
  await saved;

  await page.reload();
  await expect(
    page.getByTestId("card-card-1").getByText("Edit survives reload")
  ).toBeVisible();
});

test("keeps a moved card after a reload", async ({ page }) => {
  const saved = waitForBoardSave(page);
  await dragTo(page, "card-card-1", "column-col-review");
  await saved;

  await page.reload();
  await expect(
    page.getByTestId("column-col-review").getByTestId("card-card-1")
  ).toBeVisible();
});

test("keeps a renamed column after a reload", async ({ page }) => {
  const firstColumn = page.locator('[data-testid^="column-"]').first();

  const saved = waitForBoardSave(page);
  await firstColumn.getByLabel("Column title").fill("Renamed for keeps");
  await saved;

  await page.reload();
  await expect(
    page.locator('[data-testid^="column-"]').first().getByLabel("Column title")
  ).toHaveValue("Renamed for keeps");
});

test("saves a rename once rather than once per keystroke", async ({ page }) => {
  let saveCount = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().includes("/api/board")) {
      saveCount += 1;
    }
  });

  const input = page
    .locator('[data-testid^="column-"]')
    .first()
    .getByLabel("Column title");

  const saved = waitForBoardSave(page);
  await input.fill("");
  await input.pressSequentially("Next Up", { delay: 20 });
  await saved;
  // Give any straggling debounce a chance to fire before counting.
  await page.waitForTimeout(600);

  expect(saveCount).toBe(1);
  await page.reload();
  await expect(
    page.locator('[data-testid^="column-"]').first().getByLabel("Column title")
  ).toHaveValue("Next Up");
});

test("does not persist a discarded edit", async ({ page }) => {
  const card = page.getByTestId("card-card-2");
  await card.getByRole("button", { name: /edit gather customer signals/i }).click();
  await card.getByLabel("Edit title").fill("Discarded, never saved");
  await card.getByRole("button", { name: /discard/i }).click();

  await page.reload();
  await expect(
    page.getByTestId("card-card-2").getByText("Gather customer signals")
  ).toBeVisible();
});

test("keeps changes after signing out and back in", async ({ page }) => {
  const card = page.getByTestId("card-card-1");
  await card.getByRole("button", { name: /edit align roadmap themes/i }).click();
  await card.getByLabel("Edit title").fill("Outlives the session");

  const saved = waitForBoardSave(page);
  await card.getByRole("button", { name: /save/i }).click();
  await saved;

  await page.getByRole("button", { name: /sign out/i }).click();
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();

  await signIn(page);
  await expect(
    page.getByTestId("card-card-1").getByText("Outlives the session")
  ).toBeVisible();
});
