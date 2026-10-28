import { randomBytes } from "node:crypto";
import { OperatorRevert } from "@perplog/chain/signer";
import { type Address, ENTRY_MAX_AGE_MS, type MarketInfo } from "@perplog/core";
import {
  bindBotKey,
  claimRequestedBotKeys,
  createBotKeyRequest,
  createPlanWithEntry,
  type Db,
  getPlan,
  getStop,
  insertStop,
  listAlerts,
  listEvidence,
  type NewPlanInput,
} from "@perplog/db";
import { encryptPrivateKey } from "@perplog/db/crypto";
import { createTestDb } from "@perplog/db/testing";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { createEntryEngine } from "../src/entry-engine";

// Pass-through, so one test can make the settle write fail once after a successful send.
const dbFaults = vi.hoisted(() => ({ settleFails: 0 }));
vi.mock("@perplog/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@perplog/db")>();
  return {
    ...real,
    settleEntryFilled: (...args: Parameters<typeof real.settleEntryFilled>) => {
      if (dbFaults.settleFails > 0) {
        dbFaults.settleFails -= 1;
        return Promise.reject(new Error("connection terminated"));
      }
      return real.settleEntryFilled(...args);
    },
  };
});

import { KeyedSerial } from "../src/serial";
import { createStopEngine } from "../src/stop-engine";
import { fakeLogger, fakeTradingChain } from "./fakes";

const ACCOUNT = `0x${"a1".repeat(20)}` as Address;
const POOL_A = `0x${"b1".repeat(20)}` as Address;
const POOL_B = `0x${"b2".repeat(20)}` as Address;

const market = (pool: Address): MarketInfo => ({
  pool,
  symbol: "X-PERP",
  baseDecimals: 18,
  tickSize: 10n,
  lotSize: 10n,
  minQuantity: 10n,
  stopRegistry: null,
});

async function setup() {
  const db: Db = await createTestDb();
  const kek = randomBytes(32);
  const pk = generatePrivateKey();
  const req = await createBotKeyRequest(db);
  await claimRequestedBotKeys(db, 1, (id) => {
    const { encPk, iv, tag } = encryptPrivateKey(pk, kek, id);
    return { address: privateKeyToAddress(pk).toLowerCase() as Address, encPk, iv, tag };
  });
  await bindBotKey(db, req.id, ACCOUNT, [POOL_A, POOL_B]);
  const f = fakeTradingChain([market(POOL_A), market(POOL_B)]);
  f.state.entriesAllowed = true;
  const log = fakeLogger();
  const serial = new KeyedSerial();
  // The plan rows are stamped by the database clock; the engine's clock starts there too.
  const clock = { t: Date.now() };
  const make = () => createEntryEngine({ db, chain: f.chain, kek, log, serial, now: () => clock.t });
  let engine = make();
  const run = async () => {
    await engine.tick();
    await engine.idle();
  };
  const restart = () => {
    engine = make();
  };
  const plan = async (over: Partial<NewPlanInput> = {}) => {
    const created = await createPlanWithEntry(db, {
      account: ACCOUNT,
      pool: POOL_A,
      botKeyId: req.id,
      side: "long",
      riskRaw: 25n,
      refPrice: 1_000n,
      stopPrice: 900n,
      qtyRaw: 1_230n,
      priceBound: 1_010n,
      leverageEstBps: null,
      liqPriceEst: null,
      ...over,
    });
    if (!created) throw new Error("expected a plan");
    return created;
  };
  return { db, kek, pk, keyId: req.id, f, log, serial, clock, run, restart, plan };
}

test("a queued entry is sent once with the plan's qty and bound, and arms an entire plan stop", async () => {
  const { db, pk, f, log, run, plan } = await setup();
  const created = await plan();
  await run();
  await run();

  expect(f.sends).toHaveLength(1);
  expect(f.sends[0]).toMatchObject({
    privateKey: pk,
    owner: ACCOUNT,
    pool: POOL_A,
    isBid: true,
    qtyRaw: 1_230n,
    priceBound: 1_010n,
    sizeAtSend: 0n,
  });
  expect(f.sizes.get(POOL_A)).toBe(1_230n);

  const after = await getPlan(db, created.plan.id);
  expect(after?.status).toBe("entered");
  expect(await getStop(db, after?.stopId ?? "")).toMatchObject({
    positionSide: "long",
    triggerPrice: 900n,
    qtyMode: "entire",
    source: "plan",
    status: "armed",
  });
  const [evidence] = await listEvidence(db, {});
  expect(evidence).toMatchObject({ kind: "entry", status: "confirmed", filledRaw: 1_230n });
  expect(log.entries.find((e) => e.msg === "entry_sent")?.obj).toMatchObject({ planId: created.plan.id });
  expect(JSON.stringify(log.entries, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toContain(
    pk.slice(2),
  );
});

test("a short plan sends an ask", async () => {
  const { f, run, plan } = await setup();
  await plan({ side: "short", stopPrice: 1_100n });
  await run();
  expect(f.sends[0]?.isBid).toBe(false);
  expect(f.sizes.get(POOL_A)).toBe(-1_230n);
});

test("a zero fill fails the plan with an entry_failed alert and arms no stop", async () => {
  const { db, f, run, plan } = await setup();
  const created = await plan();
  f.script.push({ fill: 0n });
  await run();
  const after = await getPlan(db, created.plan.id);
  expect(after).toMatchObject({ status: "entry_failed", stopId: null });
  const alerts = await listAlerts(db, ACCOUNT, 0);
  expect(alerts.map((a) => a.type)).toEqual(["entry_failed"]);
  expect(alerts[0]?.payload).toMatchObject({ reason: "no_fill" });
});

test("a simulation revert fails the plan with its error name and is never retried", async () => {
  const { db, f, run, plan } = await setup();
  const created = await plan();
  f.script.push(new OperatorRevert("ImmediateOrCancelNoFill"));
  await run();
  await run();
  expect(f.sends).toHaveLength(1);
  expect((await getPlan(db, created.plan.id))?.status).toBe("entry_failed");
  expect((await listAlerts(db, ACCOUNT, 0))[0]?.payload).toMatchObject({ reason: "ImmediateOrCancelNoFill" });
});

test("an entry older than 30 s is expired and never sent", async () => {
  const { db, f, clock, run, plan } = await setup();
  const created = await plan();
  clock.t += ENTRY_MAX_AGE_MS + 1_000;
  await run();
  expect(f.sends).toHaveLength(0);
  expect((await getPlan(db, created.plan.id))?.status).toBe("entry_failed");
  expect((await listAlerts(db, ACCOUNT, 0))[0]?.payload).toMatchObject({ reason: "expired" });
});

test("a non-flat position fails position_changed and is never sent", async () => {
  const { db, f, run, plan } = await setup();
  const created = await plan();
  f.sizes.set(POOL_A, 50n);
  await run();
  expect(f.sends).toHaveLength(0);
  expect((await getPlan(db, created.plan.id))?.status).toBe("entry_failed");
  expect((await listAlerts(db, ACCOUNT, 0))[0]?.payload).toMatchObject({ reason: "position_changed" });
});

test("a pending tx from the bot requeues the entry; it is sent once the bot is idle", async () => {
  const { db, f, run, plan } = await setup();
  const created = await plan();
  f.state.externalPending = true;
  await run();
  expect(f.sends).toHaveLength(0);
  expect((await getPlan(db, created.plan.id))?.status).toBe("pending_entry");
  f.state.externalPending = false;
  await run();
  expect(f.sends).toHaveLength(1);
  expect((await getPlan(db, created.plan.id))?.status).toBe("entered");
});

test("an unknown outcome is resolved from its receipt on the next tick, never resent", async () => {
  const { db, f, run, plan } = await setup();
  const created = await plan();
  f.script.push({ unknown: 1_230n });
  await run();
  expect((await getPlan(db, created.plan.id))?.status).toBe("pending_entry");
  // Still pending on chain: the resolver waits.
  await run();
  expect(f.sends).toHaveLength(1);
  f.mine();
  await run();
  expect(f.sends).toHaveLength(1);
  const after = await getPlan(db, created.plan.id);
  expect(after?.status).toBe("entered");
  expect(after?.stopId).not.toBeNull();
});

test("after a restart, a sent entry with no receipt and no pending tx is dropped, never resent", async () => {
  const { db, f, run, restart, plan } = await setup();
  const created = await plan();
  f.script.push({ unknown: 1_230n });
  await run();
  restart();
  f.drop();
  await run();
  await run();
  expect(f.sends).toHaveLength(1);
  expect((await getPlan(db, created.plan.id))?.status).toBe("entry_failed");
  expect((await listAlerts(db, ACCOUNT, 0))[0]?.payload).toMatchObject({ reason: "dropped" });
});

test("entry and stop close for the same bot key never overlap", async () => {
  const { db, kek, keyId, f, log, serial, clock, plan } = await setup();
  // A long on POOL_A whose stop triggers, and a plan entry on the flat POOL_B, both for the same bot key.
  f.sizes.set(POOL_A, 500n);
  f.marks.set(POOL_A, { price: 900n, fromIndex: false });
  await insertStop(db, {
    account: ACCOUNT,
    pool: POOL_A,
    botKeyId: keyId,
    positionSide: "long",
    triggerPrice: 950n,
    triggerOp: "lte",
    qtyMode: "entire",
    status: "armed",
  });
  await plan({ pool: POOL_B });
  const order: string[] = [];
  const slow = async (p: { pool: Address; qtyRaw: bigint }) => {
    order.push(`start ${p.pool}`);
    await new Promise((r) => setTimeout(r, 20));
    order.push(`end ${p.pool}`);
    return p.qtyRaw;
  };
  f.script.push(slow, slow);

  const stops = createStopEngine({ db, chain: f.chain, kek, log, serial, now: () => clock.t });
  const entries = createEntryEngine({ db, chain: f.chain, kek, log, serial, now: () => clock.t });
  await Promise.all([stops.tick(), entries.tick()]);
  await Promise.all([stops.idle(), entries.idle()]);

  expect(order).toHaveLength(4);
  expect(order[0]?.replace("start", "end")).toBe(order[1]);
  expect(order[2]?.replace("start", "end")).toBe(order[3]);
});

test("a fill mined between the receipt check and the pending check is settled, not dropped", async () => {
  const { db, f, run, plan } = await setup();
  const created = await plan();
  f.script.push({ unknown: 1_230n });
  await run();
  // Next tick: the receipt read still sees nothing, then the tx is mined before the pending check.
  const receiptOf = vi.mocked(f.chain.receiptOf);
  const real = receiptOf.getMockImplementation();
  if (!real) throw new Error("fake without receiptOf");
  receiptOf.mockImplementationOnce(async () => null);
  vi.mocked(f.chain.hasPendingTx).mockImplementationOnce(async () => {
    f.mine();
    return false;
  });
  await run();
  const after = await getPlan(db, created.plan.id);
  expect(after?.status).toBe("entered");
  expect(after?.stopId).not.toBeNull();
  expect(f.sends).toHaveLength(1);
});

test("a fill whose settle write fails is re-settled from its receipt on the next tick", async () => {
  const { db, f, log, run, plan } = await setup();
  const created = await plan();
  dbFaults.settleFails = 1;
  await run();
  expect((await getPlan(db, created.plan.id))?.status).toBe("pending_entry");
  await run();
  const after = await getPlan(db, created.plan.id);
  expect(after?.status).toBe("entered");
  expect(after?.stopId).not.toBeNull();
  expect(f.sends).toHaveLength(1);
  expect(log.has("entry_execution_error")).toBe(true);
});

test("an entry with no hash that did open a position is settled from the live size and its stop armed", async () => {
  const { db, f, run, plan } = await setup();
  const created = await plan();
  f.script.push({ unknown: 1_230n, withHash: false });
  await run();
  f.mine();
  await run();
  const after = await getPlan(db, created.plan.id);
  expect(after?.status).toBe("entered");
  expect(await getStop(db, after?.stopId ?? "")).toMatchObject({ status: "armed", qtyMode: "entire" });
  expect(f.sends).toHaveLength(1);
});

test("an entry with no hash and still flat fails unresolved, never resent", async () => {
  const { db, f, run, plan } = await setup();
  const created = await plan();
  f.script.push({ unknown: 1_230n, withHash: false });
  await run();
  f.drop();
  await run();
  expect((await getPlan(db, created.plan.id))?.status).toBe("entry_failed");
  expect((await listAlerts(db, ACCOUNT, 0))[0]?.payload).toMatchObject({ reason: "unresolved" });
  expect(f.sends).toHaveLength(1);
});
