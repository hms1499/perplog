import { expect, test } from "@playwright/test";

const ACCOUNT = "/a/0x395225eab84c1b9304d42cb647238dcc90003951?range=all";
const NOT_AFFILIATED = "Independent tool for dreamDEX traders · not affiliated with dreamDEX";

test("account sections nav marks the current tab", async ({ page }) => {
  await page.goto(`${ACCOUNT}&tab=journal`);
  const nav = page.getByRole("navigation", { name: "Account sections" });
  await expect(nav.getByRole("link", { name: "Journal" })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("link", { name: "Plan" }).click();
  await expect(page).toHaveURL(/tab=plan/);
});

test("copy button copies the full address", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(ACCOUNT);
  await page.getByRole("button", { name: "Copy address" }).click();
  await expect(page.getByText("Copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "0x395225eab84c1b9304d42cb647238dcc90003951",
  );
});

test("without a database the bot chip is hidden", async ({ page }) => {
  await page.goto(ACCOUNT);
  await expect(page.getByRole("navigation", { name: "Account sections" })).toBeVisible();
  await expect(page.getByTestId("bot-chip")).toHaveCount(0);
});

test("non-account pages have the site top bar and footer", async ({ page }) => {
  for (const url of ["/", "/evidence", "/how-it-works"]) {
    await page.goto(url);
    await expect(page.getByRole("link", { name: "perplog", exact: true })).toHaveAttribute("href", "/");
    await expect(page.getByText(NOT_AFFILIATED)).toBeVisible();
  }
});

test("home explains the three steps and links to how it works", async ({ page }) => {
  await page.goto("/");
  const steps = page.getByRole("list", { name: "How PerpLog works" });
  await expect(steps.getByRole("listitem")).toHaveCount(3);
  await expect(steps.getByRole("link").first()).toHaveAttribute("href", "/how-it-works");
});

test("an unknown page keeps the site top bar and footer", async ({ page }) => {
  await page.goto("/no-such-page");
  await expect(page.getByRole("link", { name: "perplog", exact: true })).toHaveAttribute("href", "/");
  await expect(page.getByText(NOT_AFFILIATED)).toBeVisible();
});
