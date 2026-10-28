import { expect, test } from "@playwright/test";

const ACCOUNT = "/a/0x395225eab84c1b9304d42cb647238dcc90003951?range=all";
const NOT_AFFILIATED = "Independent tool for dreamDEX traders · not affiliated with dreamDEX";

test("footer says not affiliated on the landing and account pages", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(NOT_AFFILIATED)).toBeVisible();
  await page.goto(ACCOUNT);
  await expect(page.getByText(NOT_AFFILIATED)).toBeVisible();
});

test("the light page background is rgb(238, 241, 245)", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(238, 241, 245)");
});

test("no horizontal scroll at 390px wide on /, Health, Journal, Leaks and Positions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const url of [
    "/",
    ACCOUNT,
    `${ACCOUNT}&tab=journal`,
    `${ACCOUNT}&tab=leaks`,
    `${ACCOUNT}&tab=positions`,
  ]) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, url).toBeLessThanOrEqual(0);
  }
});

test("the wordmark reads perplog and links home", async ({ page }) => {
  await page.goto(ACCOUNT);
  const home = page.getByRole("link", { name: "perplog", exact: true });
  await expect(home).toHaveAttribute("href", "/");
});
