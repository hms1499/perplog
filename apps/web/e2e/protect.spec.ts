import { expect, type Page, test } from "@playwright/test";

const ACCOUNT = "0xf1a114c1604a272ec6a1da07803fc68a786480e7";
const BOT = `0xb0${"00".repeat(19)}`;

type Row = { pool: string; side: string; perplogStop: unknown };

/**
 * Mocks the protection API around the fixture positions. The session starts absent (401), becomes pending once
 * `Enable protection` is pressed, and linked on the next poll. Arming adds a PerpLog stop to the first position;
 * cancelling removes it.
 */
async function mockProtection(page: Page, opts: { linked?: boolean } = {}) {
  const state = {
    started: opts.linked ?? false,
    polls: opts.linked ? 1 : 0,
    stop: null as null | Record<string, unknown>,
    posted: null as null | Record<string, unknown>,
    firstPool: "",
  };
  const linkedBody = () => ({
    status: "linked",
    botAddress: BOT,
    account: ACCOUNT,
    linkedPools: [state.firstPool],
    missingPools: [],
  });
  await page.route("**/api/session**", async (route) => {
    const method = route.request().method();
    if (method === "POST") {
      state.started = true;
      return route.fulfill({ status: 201, json: { status: "pending", botAddress: BOT } });
    }
    if (!state.started) return route.fulfill({ status: 401, json: { error: "no_session" } });
    state.polls += 1;
    return route.fulfill({ json: state.polls > 1 ? linkedBody() : { status: "pending", botAddress: BOT } });
  });
  await page.route(`**/api/accounts/${ACCOUNT}/positions`, async (route) => {
    const res = await route.fetch();
    const rows = (await res.json()) as Row[];
    state.firstPool = rows[0]?.pool ?? "";
    if (rows[0]) rows[0].perplogStop = state.stop;
    await route.fulfill({ json: rows });
  });
  await page.route("**/api/stops", async (route) => {
    state.posted = route.request().postDataJSON();
    state.stop = {
      id: "11111111-1111-4111-8111-111111111111",
      pool: state.firstPool,
      positionSide: "long",
      triggerPrice: "1900000000000000000000",
      qtyMode: "entire",
      qtyRaw: null,
      status: "armed",
    };
    await route.fulfill({ status: 201, json: { stop: state.stop } });
  });
  await page.route("**/api/stops/*", async (route) => {
    state.stop = null;
    await route.fulfill({ json: { ok: true } });
  });
  return state;
}

test("protect flow: link, arm, see the PerpLog stop, cancel", async ({ page }) => {
  const state = await mockProtection(page);
  await page.goto(`/a/${ACCOUNT}?tab=positions`);
  await page.getByRole("button", { name: "Protect" }).first().click();
  await expect(page.getByTestId("link-wizard")).toBeVisible();
  await page.getByRole("button", { name: "Enable protection" }).click();
  await expect(page.getByTestId("bot-address")).toContainText("0xb0");
  await page.getByLabel("Trigger price").fill("1900");
  await page.getByRole("button", { name: "Arm stop" }).click();
  await expect(page.getByTestId("perplog-stop").first()).toContainText("armed");
  expect(state.posted).toEqual({
    pool: state.firstPool,
    triggerPrice: "1900000000000000000000",
    qtyMode: "entire",
  });

  await page.getByRole("button", { name: "Cancel stop" }).click();
  await expect(page.getByTestId("perplog-stop")).toHaveCount(0);
});

test("?protect={pool} opens the form for that position when already linked", async ({ page }) => {
  const state = await mockProtection(page, { linked: true });
  // Learn the fixture's first pool, then arrive the way an alert toast links here.
  await page.goto(`/a/${ACCOUNT}?tab=positions`);
  await expect(page.getByTestId("position-row").first()).toBeVisible();
  await page.goto(`/a/${ACCOUNT}?tab=positions&protect=${state.firstPool}`);
  await expect(page.getByLabel("Trigger price")).toBeVisible();
  await expect(page.getByTestId("link-wizard")).toHaveCount(0);
});

test("a toast's Protect link opens the form while already on the Positions tab", async ({ page }) => {
  const state = await mockProtection(page, { linked: true });
  await page.route("**/api/alerts?**", (route) =>
    route.fulfill({
      json: {
        alerts: state.firstPool
          ? [
              {
                id: "u1",
                type: "unprotected_position",
                pool: state.firstPool,
                symbol: "ETH-PERP",
                payload: { symbol: "ETH-PERP", side: "long", sizeRaw: "5" },
                createdAt: new Date().toISOString(),
              },
            ]
          : [],
      },
    }),
  );
  await page.goto(`/a/${ACCOUNT}?tab=positions`);
  await expect(page.getByTestId("position-row").first()).toBeVisible();
  await page.getByTestId("alert-toast").getByRole("link", { name: "Protect" }).click();
  await expect(page.getByLabel("Trigger price")).toBeVisible();
});

test("API errors show one line; pool_not_linked shows the API's message", async ({ page }) => {
  await mockProtection(page, { linked: true });
  await page.route("**/api/stops", (route) =>
    route.fulfill({ status: 409, json: { error: "pool_not_linked", message: "Link this market again." } }),
  );
  await page.goto(`/a/${ACCOUNT}?tab=positions`);
  await page.getByRole("button", { name: "Protect" }).first().click();
  await page.getByLabel("Trigger price").fill("1900");
  await page.getByRole("button", { name: "Arm stop" }).click();
  // Next's route announcer is also role=alert, so match on the line itself.
  await expect(page.getByRole("alert").filter({ hasText: "Link this market again." })).toBeVisible();
});

test("without a database there is no Protect button", async ({ page }) => {
  const probe = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/session");
  await page.goto(`/a/${ACCOUNT}?tab=positions`);
  expect((await probe).status()).toBe(503);
  await expect(page.getByTestId("position-row").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Protect" })).toHaveCount(0);
});
