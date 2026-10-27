import type { PositionUpdate } from "@perplog/chain";
import type { Address, MarketInfo } from "@perplog/core";
import {
  bindBotKey,
  claimRequestedBotKeys,
  createBotKeyRequest,
  type Db,
  getStop,
  insertStop,
  listAlerts,
  type StopRow,
  transitionStop,
  upsertWatch,
} from "@perplog/db";
import { createTestDb } from "@perplog/db/testing";
import { createAlertEngine } from "../src/alert-engine";
import { fakeChain, fakeLogger, manualTimers } from "./fakes";

const WATCHED = `0x${"a1".repeat(20)}` as Address;
const STRANGER = `0x${"a2".repeat(20)}` as Address;
const BOT = `0x${"c1".repeat(20)}` as Address;
const POOL = `0x${"b1".repeat(20)}` as Address;

const market: MarketInfo = {
  pool: POOL,
  symbol: "ETH-PERP",
  baseDecimals: 18,
  tickSize: 1n,
  lotSize: 1n,
  minQuantity: 1n,
  stopRegistry: null,
};

async function setup() {
  const db = await createTestDb();
  await upsertWatch(db, WATCHED, "watch");
  const req = await createBotKeyRequest(db);
  await claimRequestedBotKeys(db, 1, () => ({ address: BOT, encPk: "e", iv: "i", tag: "t" }));
  await bindBotKey(db, req.id, WATCHED, [POOL]);

  /** The live on-chain size per `account:pool`, read before any auto-cancel. */
  const live = new Map<string, bigint>();
  const nativeStops = { count: 0 };
  const open = { rows: [] as { account: Address; pool: Address; size: bigint }[] };
  const chain = fakeChain({
    markets: vi.fn(async () => [market]),
    readPositionSize: vi.fn(async (account: Address, pool: Address) => live.get(`${account}:${pool}`) ?? 0n),
    pendingStopLosses: vi.fn(async () => nativeStops.count),
    openPositions: vi.fn(async () => open.rows),
  });
  const clock = manualTimers();
  const log = fakeLogger();
  const engine = createAlertEngine({ db, chain, log, timers: clock.timers });
  await engine.refreshWatched();

  /** Delivers a PositionUpdated, as Reactivity would, and keeps the fake chain in step. */
  const update = async (u: PositionUpdate) => {
    live.set(`${u.account}:${u.pool}`, u.newSize);
    await engine.onUpdate(u);
    await engine.idle();
  };
  const wait = (ms: number) => clock.advance(ms, () => engine.idle());
  const armStop = (status: StopRow["status"] = "armed", account: Address = WATCHED) =>
    insertStop(db, {
      account,
      pool: POOL,
      botKeyId: req.id,
      positionSide: "long",
      triggerPrice: 100n,
      triggerOp: "lte",
      qtyMode: "entire",
      status,
    });
  const alerts = async (account: Address = WATCHED) =>
    (await listAlerts(db, account, 0)).filter((a) => a.type === "unprotected_position");

  return { db, chain, clock, log, engine, live, nativeStops, open, update, wait, armStop, alerts };
}

const statusOf = async (db: Db, id: string) => (await getStop(db, id))?.status;

test("open without a stop → unprotected alert after 60s", async () => {
  const t = await setup();
  await t.update({ account: WATCHED, pool: POOL, newSize: 5n });
  await t.wait(59_000);
  expect(await t.alerts()).toHaveLength(0);
  await t.wait(1_000);
  const alerts = await t.alerts();
  expect(alerts).toHaveLength(1);
  expect(alerts[0]?.pool).toBe(POOL);
  expect(alerts[0]?.payload).toEqual({ symbol: "ETH-PERP", side: "long", sizeRaw: "5" });
  expect(t.chain.pendingStopLosses).toHaveBeenCalledWith(WATCHED, POOL, "long");
  t.engine.stop();
});

test("a native stop-loss placed within 60s suppresses the alert", async () => {
  const t = await setup();
  await t.update({ account: WATCHED, pool: POOL, newSize: -5n });
  t.nativeStops.count = 1;
  await t.wait(60_000);
  expect(await t.alerts()).toHaveLength(0);
  expect(t.chain.pendingStopLosses).toHaveBeenCalledWith(WATCHED, POOL, "short");
  t.engine.stop();
});

test("an armed PerpLog stop suppresses the alert", async () => {
  const t = await setup();
  await t.update({ account: WATCHED, pool: POOL, newSize: 5n });
  await t.armStop();
  await t.wait(60_000);
  expect(await t.alerts()).toHaveLength(0);
  t.engine.stop();
});

test("position closed within 60s → no alert", async () => {
  const t = await setup();
  await t.update({ account: WATCHED, pool: POOL, newSize: 5n });
  await t.wait(30_000);
  await t.update({ account: WATCHED, pool: POOL, newSize: 0n });
  await t.wait(60_000);
  expect(await t.alerts()).toHaveLength(0);
  t.engine.stop();
});

test("unwatched accounts never alert", async () => {
  const t = await setup();
  await t.update({ account: STRANGER, pool: POOL, newSize: 5n });
  await t.wait(120_000);
  expect(await t.alerts(STRANGER)).toHaveLength(0);
  expect(t.chain.pendingStopLosses).not.toHaveBeenCalled();
  t.engine.stop();
});

test("size to zero auto-cancels an armed stop", async () => {
  const t = await setup();
  await t.update({ account: WATCHED, pool: POOL, newSize: 5n });
  const stop = await t.armStop();
  await t.update({ account: WATCHED, pool: POOL, newSize: 0n });
  expect(await statusOf(t.db, stop.id)).toBe("cancelled");
  t.engine.stop();
});

test("flip auto-cancels an armed stop; a triggered stop is left alone", async () => {
  const t = await setup();
  await t.update({ account: WATCHED, pool: POOL, newSize: 5n });
  const armed = await t.armStop();
  await t.update({ account: WATCHED, pool: POOL, newSize: -3n });
  expect(await statusOf(t.db, armed.id)).toBe("cancelled");

  const triggered = await t.armStop();
  await transitionStop(t.db, triggered.id, ["armed"], "triggered", { triggeredAt: new Date() });
  await t.update({ account: WATCHED, pool: POOL, newSize: 0n });
  expect(await statusOf(t.db, triggered.id)).toBe("triggered");
  t.engine.stop();
});

test("an update the live size contradicts never cancels a stop", async () => {
  const t = await setup();
  const stop = await t.armStop();
  // A late or replayed event says 0, but the chain still holds the long the stop protects.
  t.live.set(`${WATCHED}:${POOL}`, 5n);
  await t.engine.onUpdate({ account: WATCHED, pool: POOL, newSize: 0n });
  await t.engine.idle();
  expect(await statusOf(t.db, stop.id)).toBe("armed");
  t.engine.stop();
});

test("degraded feed: the 30s poll alone produces the alert within 90s", async () => {
  const t = await setup();
  t.engine.setFeed("degraded");
  await t.wait(1_000); // first poll: nothing open yet
  // The position opens right after a poll; Reactivity delivers nothing at all.
  t.open.rows = [{ account: WATCHED, pool: POOL, size: 5n }];
  t.live.set(`${WATCHED}:${POOL}`, 5n);
  await t.wait(89_000);
  const alerts = await t.alerts();
  expect(alerts).toHaveLength(1);
  expect(t.chain.openPositions).toHaveBeenCalledWith([WATCHED]);
  t.engine.stop();
});

test("degraded poll: a cached position missing from the poll closes it and cancels its stop", async () => {
  const t = await setup();
  await t.update({ account: WATCHED, pool: POOL, newSize: 5n });
  const stop = await t.armStop();
  t.live.set(`${WATCHED}:${POOL}`, 0n);
  t.open.rows = [];
  t.engine.setFeed("degraded");
  await t.wait(1_000);
  expect(await statusOf(t.db, stop.id)).toBe("cancelled");
  await t.wait(120_000);
  expect(await t.alerts()).toHaveLength(0);
  t.engine.stop();
});

test("feed back to live stops the poll", async () => {
  const t = await setup();
  t.engine.setFeed("degraded");
  await t.wait(1_000);
  const polls = vi.mocked(t.chain.openPositions).mock.calls.length;
  t.engine.setFeed("live");
  await t.wait(120_000);
  expect(vi.mocked(t.chain.openPositions).mock.calls.length).toBe(polls);
  t.engine.stop();
});
