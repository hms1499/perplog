import { expect, test } from "@playwright/test";

const LIQUIDATED = "/a/0x395225eab84c1b9304d42cb647238dcc90003951";

test("journal shows liquidated trade with explorer link and filters by exit", async ({ page }) => {
  await page.goto(`${LIQUIDATED}?tab=journal&range=all`);
  await expect(page.getByTestId("trade-card").first()).toBeVisible();
  await page.getByLabel("Exit").selectOption("LIQUIDATED");
  await expect(page.getByTestId("trade-card")).toHaveCount(2);
  const card = page.getByTestId("trade-card").first();
  await expect(card).toContainText("Liquidated");
  await expect(card.getByRole("link", { name: "View tx" })).toHaveAttribute(
    "href",
    /explorer\.testnet\.somnia\.network\/tokyo\/tx\/0x/,
  );
});

test("journal side filter keeps only shorts", async ({ page }) => {
  await page.goto(`${LIQUIDATED}?tab=journal&range=all`);
  await expect(page.getByTestId("trade-card").first()).toBeVisible();
  await page.getByLabel("Side").selectOption("short");
  await expect(page.getByTestId("trade-card").first()).toContainText("Short");
  await expect(page.getByTestId("trade-card").filter({ hasText: "Long" })).toHaveCount(0);
});

test("leaks tab lists leaks by amount with share of losses", async ({ page }) => {
  await page.goto(`${LIQUIDATED}?tab=leaks&range=all`);
  const cards = page.getByTestId("leak-card");
  await expect(cards.first()).toContainText("Losses on trades without a stop-loss");
  await expect(cards.nth(1)).toContainText("Liquidations");
  await expect(cards.first()).toContainText("% of your losses");
  await cards.nth(1).getByRole("button", { name: "Show trades" }).click();
  await expect(cards.nth(1).getByTestId("trade-card")).toHaveCount(2);
});
