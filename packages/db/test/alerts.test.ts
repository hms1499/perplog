import type { Address } from "@perplog/core";
import { alerts, insertAlert, listAlerts, listAlertsSince } from "../src";
import { createTestDb } from "../src/testing";

const ACCOUNT = `0x${"a1".repeat(20)}` as Address;
const POOL = `0x${"b2".repeat(20)}` as Address;
const POOL2 = `0x${"b3".repeat(20)}` as Address;

test("insertAlert dedupes within the window, per pool", async () => {
  const db = await createTestDb();
  const a = { account: ACCOUNT, type: "unprotected_position" as const, pool: POOL, payload: { n: 1 } };
  expect(await insertAlert(db, { ...a, dedupeWithinSec: 600 })).toBe(true);
  expect(await insertAlert(db, { ...a, dedupeWithinSec: 600 })).toBe(false);
  expect(await insertAlert(db, { ...a, pool: POOL2, dedupeWithinSec: 600 })).toBe(true);
  expect(await insertAlert(db, { ...a, type: "stop_done", dedupeWithinSec: 600 })).toBe(true);
  // without a window there is no dedupe
  expect(await insertAlert(db, a)).toBe(true);
});

test("insertAlert dedupes a poolless alert against poolless alerts only", async () => {
  const db = await createTestDb();
  const a = { account: ACCOUNT, type: "bot_low_gas" as const, payload: {} };
  expect(await insertAlert(db, { ...a, dedupeWithinSec: 600 })).toBe(true);
  expect(await insertAlert(db, { ...a, dedupeWithinSec: 600 })).toBe(false);
});

test("listAlerts returns newest first, since a timestamp, with a limit", async () => {
  const db = await createTestDb();
  const base = { account: ACCOUNT, type: "stop_done" as const, payload: { k: "v" } };
  await insertAlert(db, { ...base, pool: POOL });
  await insertAlert(db, { ...base, pool: POOL2 });
  const all = await listAlerts(db, ACCOUNT, 0);
  expect(all).toHaveLength(2);
  expect(all[0]?.createdAt.getTime()).toBeGreaterThanOrEqual(all[1]?.createdAt.getTime() ?? 0);
  expect(all[0]?.payload).toEqual({ k: "v" });
  expect(await listAlerts(db, ACCOUNT, 0, 1)).toHaveLength(1);
  expect(await listAlerts(db, ACCOUNT, Date.now() + 60_000)).toHaveLength(0);
  expect(await listAlerts(db, POOL, 0)).toHaveLength(0);
});

test("listAlertsSince returns the oldest first from a timestamp, so a poller can page forward", async () => {
  const db = await createTestDb();
  // Explicit, distinct times: PGlite's clock can give back-to-back inserts the same timestamp.
  const t0 = Date.now() - 10_000;
  for (let i = 0; i < 3; i++) {
    await db
      .insert(alerts)
      .values({ account: ACCOUNT, type: "stop_done", payload: { i }, createdAt: new Date(t0 + i * 1000) });
  }
  const page = await listAlertsSince(db, ACCOUNT, 0, 2);
  expect(page.map((a) => a.payload)).toEqual([{ i: 0 }, { i: 1 }]);
  const rest = await listAlertsSince(db, ACCOUNT, page[1]?.createdAt.getTime() ?? 0, 50);
  expect(rest.map((a) => a.payload)).toContainEqual({ i: 2 });
  expect(await listAlertsSince(db, ACCOUNT, Date.now() + 60_000, 50)).toHaveLength(0);
});
