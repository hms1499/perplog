import { expect, test } from "@playwright/test";

test("positions tab lists open positions with coverage and distance", async ({ page }) => {
  await page.goto("/a/0xf1a114c1604a272ec6a1da07803fc68a786480e7?tab=positions");
  const rows = page.getByTestId("position-row");
  await expect(rows.first()).toBeVisible();
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText(/None|%|Full/);
});

test("protect note appears when arriving from a leak fix", async ({ page }) => {
  await page.goto("/a/0xf1a114c1604a272ec6a1da07803fc68a786480e7?tab=positions&note=protect");
  await expect(page.getByText("One-click protection is coming in the next release.")).toBeVisible();
});

test("account without open positions says so", async ({ page }) => {
  await page.goto("/a/0xe4695e02a6ffc85ddd48858fd3325f2a670b1a29?tab=positions");
  await expect(page.getByText("No open positions.")).toBeVisible();
});

test("health tab renders the equity chart", async ({ page }) => {
  await page.goto("/a/0x31b0480ff2ec5d0a4d9480a9f8c8802897c08281?range=all");
  await expect(page.getByTestId("equity-chart")).toBeVisible();
});
