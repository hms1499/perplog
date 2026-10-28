import { expect, test } from "@playwright/test";

const HASH = `0x${"8c".repeat(32)}`;
const ACCOUNT = "0xfd27ba6bf60277cf9c609eb5b5ba299345152bb7";

test("evidence shows one row per execution with a tx link", async ({ page }) => {
  await page.route("**/api/executions**", (route) =>
    route.fulfill({
      json: {
        rows: [
          {
            kind: "stop_close",
            status: "confirmed",
            account: ACCOUNT,
            pool: `0x${"a1".repeat(20)}`,
            symbol: "BTC-PERP",
            isBid: false,
            filledRaw: "7180000",
            avgPrice: "63882500000000000000000",
            txHash: HASH,
            explorerUrl: `https://explorer.testnet.somnia.network/tokyo/tx/${HASH}`,
            createdAt: "2026-10-28T09:41:00.000Z",
          },
          {
            kind: "entry",
            status: "confirmed",
            account: ACCOUNT,
            pool: `0x${"a1".repeat(20)}`,
            symbol: "BTC-PERP",
            isBid: true,
            filledRaw: "7180000",
            avgPrice: "64251000000000000000000",
            txHash: `0x${"51".repeat(32)}`,
            explorerUrl: `https://explorer.testnet.somnia.network/tokyo/tx/0x${"51".repeat(32)}`,
            createdAt: "2026-10-28T09:12:00.000Z",
          },
        ],
        totals: { transactions: 2, entries: 1, stopCloses: 1, medianStopLatencyMs: 2400 },
      },
    }),
  );
  await page.goto("/evidence");
  await expect(page.getByRole("heading", { name: "Every order PerpLog sent, on-chain" })).toBeVisible();
  const rows = page.getByTestId("evidence-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Stop close");
  await expect(rows.first()).toContainText("BTC-PERP");
  await expect(rows.first().getByRole("link", { name: /0x8c8c…8c8c/ })).toHaveAttribute(
    "href",
    `https://explorer.testnet.somnia.network/tokyo/tx/${HASH}`,
  );
  await expect(page.getByText("2.4 s")).toBeVisible();
});

test("without a database evidence says it is unavailable", async ({ page }) => {
  await page.goto("/evidence");
  await expect(page.getByText("The evidence log needs PerpLog's database")).toBeVisible();
});

test("how-it-works renders", async ({ page }) => {
  await page.goto("/how-it-works");
  await expect(page.getByRole("heading", { name: "Why stops are bot-held" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What the bot may send" })).toBeVisible();
});
