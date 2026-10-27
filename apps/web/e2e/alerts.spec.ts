import { expect, test } from "@playwright/test";

const ACCOUNT = "0xf1a114c1604a272ec6a1da07803fc68a786480e7";
const POOL = "0x00000000000000000000000000000000000000a1";
const TX = `0x${"ab".repeat(32)}`;

test("alerts appear once as toasts with a Protect link and an explorer link", async ({ page }) => {
  const now = new Date().toISOString();
  await page.route("**/api/alerts?**", (route) =>
    route.fulfill({
      json: {
        alerts: [
          {
            id: "a1",
            type: "unprotected_position",
            pool: POOL,
            symbol: "ETH-PERP",
            payload: { symbol: "ETH-PERP", side: "long", sizeRaw: "5" },
            createdAt: now,
          },
          {
            id: "a2",
            type: "stop_done",
            pool: POOL,
            symbol: "ETH-PERP",
            payload: { stopId: "s1", pool: POOL, txHashes: [TX], closedRaw: "5" },
            createdAt: now,
          },
        ],
      },
    }),
  );
  await page.goto(`/a/${ACCOUNT}`);
  const toasts = page.getByTestId("alert-toast");
  await expect(toasts).toHaveCount(2);
  await expect(toasts.nth(0)).toContainText("ETH-PERP long has no stop-loss.");
  await expect(toasts.nth(0).getByRole("link", { name: "Protect" })).toHaveAttribute(
    "href",
    `/a/${ACCOUNT}?tab=positions&protect=${POOL}`,
  );
  await expect(toasts.nth(1)).toContainText("PerpLog stop closed ETH-PERP.");
  await expect(toasts.nth(1).getByRole("link")).toHaveAttribute("href", new RegExp(`/tx/${TX}$`));
  // The same alerts come back on the next 5 s poll: still two toasts.
  await page.waitForTimeout(5_500);
  await expect(toasts).toHaveCount(2);
});

test("Watch this account switches to Watching", async ({ page }) => {
  await page.route("**/api/session", (route) =>
    route.fulfill({ status: 401, json: { error: "no_session" } }),
  );
  let watched: unknown = null;
  await page.route("**/api/watch", async (route) => {
    watched = route.request().postDataJSON();
    await route.fulfill({ json: { watching: true } });
  });
  await page.goto(`/a/${ACCOUNT}`);
  await page.getByRole("button", { name: "Watch this account" }).click();
  await expect(page.getByText("Watching")).toBeVisible();
  expect(watched).toEqual({ account: ACCOUNT });
});

test("without a database there is no Watch button and no toast", async ({ page }) => {
  const probe = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/session");
  await page.goto(`/a/${ACCOUNT}`);
  expect((await probe).status()).toBe(503);
  await expect(page.getByTestId("equity-chart")).toBeVisible();
  await expect(page.getByRole("button", { name: "Watch this account" })).toHaveCount(0);
  await expect(page.getByTestId("alert-toast")).toHaveCount(0);
});
