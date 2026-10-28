import { expect, type Page, test } from "@playwright/test";

const ACCOUNT = "0xf1a114c1604a272ec6a1da07803fc68a786480e7";
const BOT = `0xb0${"00".repeat(19)}`;
const POOL = `0x${"a1".repeat(20)}`;
const PLAN_ID = "11111111-2222-3333-4444-555555555555";
const E18 = 10n ** 18n;

const quoteBody = (qtyRaw: string) => ({
  qtyRaw,
  refPrice: (64_248n * E18).toString(),
  stopPrice: (63_900n * E18).toString(),
  priceBound: (64_569n * E18).toString(),
  notionalRaw: (4_613n * E18).toString(),
  effectiveRiskRaw: (24_98n * 10n ** 16n).toString(),
  capped: false,
  liqPriceEst: (58_410n * E18).toString(),
  leverageEstBps: "46000",
  warnings: [],
});

/**
 * Markets, the book and quotes are always mocked (`book: "fail"` answers 500); `linked` adds a linked session,
 * `plans` the place-and-poll flow.
 */
async function mockPlan(page: Page, opts: { linked?: boolean; plans?: boolean; book?: "ok" | "fail" } = {}) {
  await page.route("**/api/markets", (route) =>
    route.fulfill({
      json: [
        {
          pool: POOL,
          symbol: "BTC-PERP",
          baseDecimals: 8,
          tickSize: (10n ** 17n).toString(),
          lotSize: "10000",
          minQuantity: "10000",
          stopRegistry: null,
        },
      ],
    }),
  );
  await page.route("**/api/markets/*/book", (route) =>
    opts.book === "fail"
      ? route.fulfill({ status: 500, json: { error: "internal" } })
      : route.fulfill({ json: { bestBid: (64_200n * E18).toString(), bestAsk: (64_250n * E18).toString() } }),
  );
  await page.route("**/api/plans/quote", async (route) => {
    const body = route.request().postDataJSON() as { riskRaw: string; stopPrice: string };
    if (body.stopPrice === (70_000n * E18).toString()) {
      return route.fulfill({ status: 400, json: { error: "stop_wrong_side" } });
    }
    const qty = body.riskRaw === (25n * E18).toString() ? "7180000" : "14360000";
    return route.fulfill({ json: quoteBody(qty) });
  });
  if (opts.linked) {
    await page.route("**/api/session**", (route) =>
      route.fulfill({
        json: { status: "linked", botAddress: BOT, account: ACCOUNT, linkedPools: [POOL], missingPools: [] },
      }),
    );
  }
  if (opts.plans) {
    let polls = 0;
    await page.route("**/api/plans", (route) =>
      route.fulfill({
        status: 201,
        json: {
          plan: {
            id: PLAN_ID,
            pool: POOL,
            side: "long",
            status: "pending_entry",
            stopId: null,
            txHash: null,
          },
        },
      }),
    );
    await page.route(`**/api/plans/${PLAN_ID}`, (route) => {
      polls += 1;
      const entered = polls > 1;
      return route.fulfill({
        json: {
          plan: {
            id: PLAN_ID,
            pool: POOL,
            side: "long",
            status: entered ? "entered" : "pending_entry",
            stopId: entered ? "99999999-2222-3333-4444-555555555555" : null,
            txHash: entered ? `0x${"ab".repeat(32)}` : null,
          },
        },
      });
    });
  }
}

const open = (page: Page) => page.goto(`/a/${ACCOUNT}?tab=plan`);

test("ticket shows the live bid and ask and a stop shortcut fills the stop", async ({ page }) => {
  await mockPlan(page);
  await open(page);
  await expect(page.getByTestId("book-line")).toContainText("64,200");
  await expect(page.getByTestId("book-line")).toContainText("64,250");
  await page.getByRole("button", { name: "−2%" }).click();
  // 64,250 × 0.98 = 62,965 at tick 0.1: written without separators, at tick decimals, so it stays editable.
  await expect(page.getByLabel("Stop price")).toHaveValue("62965.0");
});

test("book failure does not block quoting", async ({ page }) => {
  await mockPlan(page, { book: "fail" });
  await open(page);
  await expect(page.getByTestId("book-line")).toContainText("—");
  await expect(page.getByRole("button", { name: "−2%" })).toHaveCount(0);
  await page.getByLabel("Max loss if the stop hits").fill("25");
  await page.getByLabel("Stop price").fill("63900");
  await expect(page.getByTestId("plan-quote")).toContainText("0.0718");
});

test("quote updates as risk and stop change", async ({ page }) => {
  await mockPlan(page);
  await open(page);
  await page.getByLabel("Max loss if the stop hits").fill("25");
  await page.getByLabel("Stop price").fill("63900");
  const quote = page.getByTestId("plan-quote");
  await expect(quote).toContainText("0.0718");
  const ladder = page.getByRole("img", { name: /Entry .* stop .* liquidation/i });
  await expect(ladder).toBeVisible();
  await expect(quote).toContainText("Stop · held by PerpLog");
  await expect(quote).toContainText("Liquidation (est.)");
  await page.getByLabel("Max loss if the stop hits").fill("50");
  await expect(quote).toContainText("0.1436");
  await expect(quote).toContainText("58,410");
});

test("quote error is shown in words", async ({ page }) => {
  await mockPlan(page);
  await open(page);
  await page.getByLabel("Max loss if the stop hits").fill("25");
  await page.getByLabel("Stop price").fill("70000");
  await expect(page.getByTestId("plan-quote")).toContainText(
    "Your stop must be below the entry price for a long",
  );
});

test("Place order needs a linked session", async ({ page }) => {
  await mockPlan(page);
  await page.route("**/api/session**", (route) =>
    route.fulfill({ status: 401, json: { error: "no_session" } }),
  );
  await open(page);
  await page.getByLabel("Max loss if the stop hits").fill("25");
  await page.getByLabel("Stop price").fill("63900");
  await expect(page.getByTestId("plan-quote")).toContainText("0.0718");
  await expect(page.getByRole("button", { name: "Place order" })).toHaveCount(0);
  await expect(page.getByTestId("link-wizard")).toBeVisible();
});

test("placing shows Entering then Entered with the stop armed", async ({ page }) => {
  await mockPlan(page, { linked: true, plans: true });
  await open(page);
  await page.getByLabel("Max loss if the stop hits").fill("25");
  await page.getByLabel("Stop price").fill("63900");
  await expect(page.getByTestId("plan-quote")).toContainText("0.0718");
  await page.getByRole("button", { name: "Place order" }).click();
  const status = page.getByTestId("plan-status");
  await expect(status).toContainText("Sending entry");
  await expect(status).toContainText("✓ Protected");
});

test("without a database there is no Place order button", async ({ page }) => {
  await mockPlan(page);
  await open(page);
  await page.getByLabel("Max loss if the stop hits").fill("25");
  await page.getByLabel("Stop price").fill("63900");
  await expect(page.getByTestId("plan-quote")).toContainText("0.0718");
  await expect(page.getByRole("button", { name: "Place order" })).toHaveCount(0);
  await expect(page.getByTestId("link-wizard")).toHaveCount(0);
});

test("Place order waits for the quote of what is typed and posts that input", async ({ page }) => {
  await mockPlan(page, { linked: true, plans: true });
  let posted: { riskRaw?: string } | null = null;
  await page.route("**/api/plans", (route) => {
    posted = route.request().postDataJSON() as { riskRaw: string };
    return route.fulfill({
      status: 201,
      json: {
        plan: { id: PLAN_ID, pool: POOL, side: "long", status: "pending_entry", stopId: null, txHash: null },
      },
    });
  });
  await open(page);
  await page.getByLabel("Max loss if the stop hits").fill("25");
  await page.getByLabel("Stop price").fill("63900");
  await expect(page.getByTestId("plan-quote")).toContainText("0.0718");
  const place = page.getByRole("button", { name: "Place order" });
  await expect(place).toBeEnabled();
  // Edited after the preview: Place is off until the preview catches up.
  await page.getByLabel("Max loss if the stop hits").fill("50");
  await expect(place).toBeDisabled();
  await expect(page.getByTestId("plan-quote")).toContainText("0.1436");
  await expect(place).toBeEnabled();
  await place.click();
  await expect.poll(() => posted?.riskRaw).toBe((50n * E18).toString());
});

test("retyping the stop dims the ladder until the new quote arrives", async ({ page }) => {
  await mockPlan(page);
  await page.route("**/api/plans/quote", async (route) => {
    const body = route.request().postDataJSON() as { stopPrice: string };
    if (body.stopPrice === (63_800n * E18).toString()) await new Promise((r) => setTimeout(r, 2_000));
    return route.fulfill({ json: quoteBody("7180000") });
  });
  await open(page);
  await page.getByLabel("Max loss if the stop hits").fill("25");
  await page.getByLabel("Stop price").fill("63900");
  await expect(page.getByTestId("plan-quote")).toContainText("Stop · held by PerpLog");
  await page.getByLabel("Stop price").fill("63800");
  await expect(page.getByText("Updating…")).toBeVisible();
  await expect(page.getByTestId("plan-quote")).toContainText("Stop · held by PerpLog");
});

test("a quoted plan at 390px wide has no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockPlan(page);
  await open(page);
  await page.getByLabel("Max loss if the stop hits").fill("25");
  await page.getByLabel("Stop price").fill("63900");
  await expect(page.getByTestId("plan-quote")).toContainText("0.0718");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a five-digit max loss fits inside the ladder at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockPlan(page);
  await page.route("**/api/plans/quote", (route) =>
    route.fulfill({
      json: { ...quoteBody("7180000"), effectiveRiskRaw: (1_234_567n * 10n ** 16n).toString() },
    }),
  );
  await open(page);
  await page.getByLabel("Max loss if the stop hits").fill("12345.67");
  await page.getByLabel("Stop price").fill("63900");
  await expect(page.getByTestId("plan-quote")).toContainText("12,345.67");
  const overflow = await page.getByRole("img", { name: /Entry/ }).evaluate((svg) => {
    const width = (svg as SVGSVGElement).viewBox.baseVal.width;
    return Math.max(
      ...Array.from(svg.querySelectorAll("text")).map((t) => t.getBBox().x + t.getBBox().width - width),
    );
  });
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the protection strip reads cleanly without a bot address", async ({ page }) => {
  await mockPlan(page);
  await page.route("**/api/session**", (route) =>
    route.fulfill({
      json: { status: "linked", botAddress: null, account: ACCOUNT, linkedPools: [POOL], missingPools: [] },
    }),
  );
  await open(page);
  const strip = page.getByText("can only close your positions.");
  await expect(strip).toBeVisible();
  expect(await strip.textContent()).toBe("PerpLog's bot can only close your positions.");
});
