import type { Address, MarketInfo } from "@perplog/core";
import {
  bindBotKey,
  claimRequestedBotKeys,
  createBotKeyRequest,
  type Db,
  getBotKey,
  insertStop,
  listAccountStops,
  listAlerts,
  type StopRow,
  transitionStop,
} from "@perplog/db";
import { createTestDb } from "@perplog/db/testing";
import { checkLinks } from "../src/link-watcher";
import { fakeChain, fakeLogger } from "./fakes";

const ACCOUNT = `0x${"a1".repeat(20)}` as Address;
const BOT = `0x${"c1".repeat(20)}` as Address;
const POOL_A = `0x${"b1".repeat(20)}` as Address;
const POOL_B = `0x${"b2".repeat(20)}` as Address;

const market = (pool: Address): MarketInfo => ({
  pool,
  symbol: "X-PERP",
  baseDecimals: 18,
  tickSize: 1n,
  lotSize: 1n,
  minQuantity: 1n,
  stopRegistry: null,
});

async function setup(): Promise<{ db: Db; keyId: string; stopA: StopRow; stopB: StopRow }> {
  const db = await createTestDb();
  const req = await createBotKeyRequest(db);
  await claimRequestedBotKeys(db, 1, () => ({ address: BOT, encPk: "e", iv: "i", tag: "t" }));
  await bindBotKey(db, req.id, ACCOUNT, [POOL_A, POOL_B]);
  const mk = (pool: Address) =>
    insertStop(db, {
      account: ACCOUNT,
      pool,
      botKeyId: req.id,
      positionSide: "long",
      triggerPrice: 100n,
      triggerOp: "lte",
      qtyMode: "entire",
      status: "armed",
    });
  return { db, keyId: req.id, stopA: await mk(POOL_A), stopB: await mk(POOL_B) };
}

const statusOf = async (db: Db, id: string): Promise<string | undefined> =>
  (await listAccountStops(db, ACCOUNT, ["armed", "paused", "triggered"])).find((s) => s.id === id)?.status;

const chainGranting = (granted: Address[] | Error) =>
  fakeChain({
    markets: vi.fn(async () => [market(POOL_A), market(POOL_B)]),
    grantedPools: vi.fn(async () => (granted instanceof Error ? Promise.reject(granted) : granted)),
  });

test("losing a pool's grant pauses that pool's armed stop and alerts once", async () => {
  const { db, keyId, stopA, stopB } = await setup();
  const chain = chainGranting([POOL_B]);
  await checkLinks(db, chain, fakeLogger());
  expect(chain.grantedPools).toHaveBeenCalledWith(ACCOUNT, BOT, [POOL_A, POOL_B]);
  expect(await statusOf(db, stopA.id)).toBe("paused");
  expect(await statusOf(db, stopB.id)).toBe("armed");
  const key = await getBotKey(db, keyId);
  expect(key?.status).toBe("linked");
  expect(key?.linkedPools).toEqual([POOL_B]);
  const alerts = await listAlerts(db, ACCOUNT, 0);
  expect(alerts).toHaveLength(1);
  expect(alerts[0]?.type).toBe("link_revoked");
  expect(alerts[0]?.payload).toEqual({ pools: [POOL_A] });
  // a second tick must neither re-alert nor change anything
  await checkLinks(db, chain, fakeLogger());
  expect(await listAlerts(db, ACCOUNT, 0)).toHaveLength(1);
  expect(await statusOf(db, stopA.id)).toBe("paused");
});

test("grant back re-arms a paused stop", async () => {
  const { db, stopA } = await setup();
  await checkLinks(db, chainGranting([POOL_B]), fakeLogger());
  expect(await statusOf(db, stopA.id)).toBe("paused");
  await checkLinks(db, chainGranting([POOL_A, POOL_B]), fakeLogger());
  expect(await statusOf(db, stopA.id)).toBe("armed");
  expect(await listAlerts(db, ACCOUNT, 0)).toHaveLength(1);
});

test("no grants at all marks the key revoked, pauses everything, and a later grant re-links it", async () => {
  const { db, keyId, stopA, stopB } = await setup();
  await checkLinks(db, chainGranting([]), fakeLogger());
  const key = await getBotKey(db, keyId);
  expect(key?.status).toBe("revoked");
  expect(key?.linkedPools).toEqual([]);
  expect(await statusOf(db, stopA.id)).toBe("paused");
  expect(await statusOf(db, stopB.id)).toBe("paused");
  const alerts = await listAlerts(db, ACCOUNT, 0);
  expect(alerts).toHaveLength(1);
  const payload = (alerts[0]?.payload ?? { pools: [] }) as { pools: string[] };
  expect([...payload.pools].sort()).toEqual([POOL_A, POOL_B]);
  // revoked keys are still watched: the grant coming back re-links and re-arms
  await checkLinks(db, chainGranting([POOL_A]), fakeLogger());
  expect((await getBotKey(db, keyId))?.status).toBe("linked");
  expect(await statusOf(db, stopA.id)).toBe("armed");
  expect(await statusOf(db, stopB.id)).toBe("paused");
});

test("a failed grant read changes nothing", async () => {
  const { db, keyId, stopA, stopB } = await setup();
  const log = fakeLogger();
  await checkLinks(db, chainGranting(new Error("rpc down")), log);
  expect(await statusOf(db, stopA.id)).toBe("armed");
  expect(await statusOf(db, stopB.id)).toBe("armed");
  expect(await listAlerts(db, ACCOUNT, 0)).toHaveLength(0);
  const key = await getBotKey(db, keyId);
  expect(key?.status).toBe("linked");
  expect(key?.linkedPools).toEqual([POOL_A, POOL_B]);
  expect(log.entries.some((e) => e.level !== "info")).toBe(true);
});

test("a failed or empty markets read changes nothing", async () => {
  const { db, stopA, stopB } = await setup();
  const grantedPools = vi.fn(async () => []);
  for (const markets of [
    vi.fn(async () => Promise.reject(new Error("indexer down"))),
    vi.fn(async () => [] as MarketInfo[]),
  ]) {
    await checkLinks(db, fakeChain({ markets, grantedPools }), fakeLogger()).catch(() => {});
    expect(await statusOf(db, stopA.id)).toBe("armed");
    expect(await statusOf(db, stopB.id)).toBe("armed");
  }
  expect(grantedPools).not.toHaveBeenCalled();
  expect(await listAlerts(db, ACCOUNT, 0)).toHaveLength(0);
});

test("with no linked or revoked keys it does not touch the chain", async () => {
  const db = await createTestDb();
  await checkLinks(db, fakeChain(), fakeLogger());
});

test("a lost pool with no stops revokes the pool without alerting", async () => {
  const { db, keyId, stopA, stopB } = await setup();
  await transitionStop(db, stopB.id, ["armed"], "cancelled");
  await checkLinks(db, chainGranting([POOL_A]), fakeLogger());
  expect((await getBotKey(db, keyId))?.linkedPools).toEqual([POOL_A]);
  expect(await statusOf(db, stopA.id)).toBe("armed");
  expect(await listAlerts(db, ACCOUNT, 0)).toHaveLength(0);
});
