import type { Address } from "@perplog/core";
import {
  bindSession,
  createBotKeyRequest,
  createSession,
  gasSentTodayWei,
  hitRateLimit,
  listWatchedAccounts,
  recordTopUp,
  upsertWatch,
} from "../src";
import { createTestDb } from "../src/testing";

test("11th POST in a minute is refused, next minute is allowed", async () => {
  const db = await createTestDb();
  const now = new Date("2026-10-27T10:00:10Z");
  for (let i = 0; i < 10; i++) expect(await hitRateLimit(db, "s1", 10, now)).toBe(true);
  expect(await hitRateLimit(db, "s1", 10, now)).toBe(false);
  expect(await hitRateLimit(db, "s2", 10, now)).toBe(true);
  expect(await hitRateLimit(db, "s1", 10, new Date(now.getTime() + 60_000))).toBe(true);
});

const A1 = `0x${"a1".repeat(20)}` as Address;
const A2 = `0x${"a2".repeat(20)}` as Address;
const A3 = `0x${"a3".repeat(20)}` as Address;

test("watched accounts are the union of watch rows and bound sessions", async () => {
  const db = await createTestDb();
  await upsertWatch(db, A1, "watch");
  await upsertWatch(db, A1, "session");
  await upsertWatch(db, A2, "session");
  const key = await createBotKeyRequest(db);
  const s = await createSession(db, key.id);
  await bindSession(db, s.id, A3);
  await createSession(db, key.id); // unbound: ignored
  expect((await listWatchedAccounts(db)).sort()).toEqual([A1, A2, A3]);
});

test("gasSentTodayWei sums top-ups since 00:00 UTC", async () => {
  const db = await createTestDb();
  const key = await createBotKeyRequest(db);
  const other = await createBotKeyRequest(db);
  await recordTopUp(db, key.id, 5n * 10n ** 17n, "0x1");
  await recordTopUp(db, key.id, 5n * 10n ** 17n, "0x2");
  await recordTopUp(db, other.id, 7n, "0x3");
  expect(await gasSentTodayWei(db, key.id, new Date())).toBe(10n ** 18n);
  // "tomorrow" in UTC: today's top-ups no longer count
  expect(await gasSentTodayWei(db, key.id, new Date(Date.now() + 2 * 86_400_000))).toBe(0n);
});
