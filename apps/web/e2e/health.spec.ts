import { expect, test } from "@playwright/test";

test("liquidated account shows reconciled badge, liquidation cost and its top leak", async ({ page }) => {
  await page.goto("/a/0x395225eab84c1b9304d42cb647238dcc90003951?range=all");
  await expect(page.getByText("✓ Reconciled with chain")).toBeVisible();
  await expect(page.getByText("1,782.26 USDso")).toBeVisible();
  await expect(page.getByTestId("top-leak")).toContainText("Losses on trades without a stop-loss");
});

test("unknown address shows empty state", async ({ page }) => {
  await page.goto("/a/0x000000000000000000000000000000000000dead");
  await expect(page.getByText("No perps activity for this address.")).toBeVisible();
});

test("landing form rejects bad input and navigates on valid input", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox").fill("hello");
  await page.getByRole("button", { name: "Analyze" }).click();
  await expect(page.getByText("Enter a valid 0x address")).toBeVisible();
  await page.getByRole("textbox").fill(" 0x31B0480FF2EC5D0A4D9480A9F8C8802897C08281 ");
  await page.getByRole("button", { name: "Analyze" }).click();
  await expect(page).toHaveURL(/\/a\/0x31b0480ff2ec5d0a4d9480a9f8c8802897c08281/);
});
