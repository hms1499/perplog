import { expect, test } from "@playwright/test";

const ADDRESS = "0x395225eab84c1b9304d42cb647238dcc90003951";

/** Monday 00:00 UTC of the week holding `ms`, as YYYY-MM-DD (mirrors core's isoWeekStart). */
function weekOf(ms: number): string {
  const day = Math.floor(ms / 86_400_000);
  return new Date((day - ((day + 3) % 7)) * 86_400_000).toISOString().slice(0, 10);
}
const THIS_WEEK = weekOf(Date.now());
const LAST_WEEK = weekOf(Date.now() - 7 * 86_400_000);

test("the report tab shows report-image and a Share on X link to /r/<address>/<week>", async ({ page }) => {
  await page.goto(`/a/${ADDRESS}?tab=report`);
  await expect(page.getByTestId("report-image")).toBeVisible();
  const share = page.getByRole("link", { name: "Share on X" });
  const href = decodeURIComponent((await share.getAttribute("href")) ?? "");
  expect(href).toContain("https://x.com/intent/post?text=");
  expect(href).toContain(`/r/${ADDRESS}/${THIS_WEEK}`);
  expect(href).toContain("@DreamDEXSomnia");
});

test("the week picker moves to the previous week and disables next on the current week", async ({ page }) => {
  await page.goto(`/a/${ADDRESS}?tab=report`);
  await expect(page.getByRole("button", { name: "Next week" })).toBeDisabled();
  await page.getByRole("button", { name: "Previous week" }).click();
  await expect(page.getByTestId("report-image")).toHaveAttribute("src", new RegExp(`/${LAST_WEEK}$`));
  await expect(page.getByRole("button", { name: "Next week" })).toBeEnabled();
});

test("Download PNG links to the OG route with a download name", async ({ page }) => {
  await page.goto(`/a/${ADDRESS}?tab=report`);
  const download = page.getByRole("link", { name: "Download PNG" });
  await expect(download).toHaveAttribute("href", `/api/og/report/${ADDRESS}/${THIS_WEEK}`);
  await expect(download).toHaveAttribute("download", `perplog-${THIS_WEEK}.png`);
});

test("the OG route returns image/png", async ({ request }) => {
  const res = await request.get(`/api/og/report/${ADDRESS}/2026-10-19`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
  const bad = await request.get(`/api/og/report/${ADDRESS}/2026-10-20`);
  expect(bad.status()).toBe(400);
});

test("/r/<address>/<week> has og:image pointing at the OG route", async ({ page }) => {
  await page.goto(`/r/${ADDRESS}/2026-10-19`);
  const og = page.locator('meta[property="og:image"]');
  await expect(og).toHaveAttribute("content", new RegExp(`/api/og/report/${ADDRESS}/2026-10-19$`));
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
});
