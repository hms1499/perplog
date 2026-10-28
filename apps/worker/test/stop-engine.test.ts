import { randomBytes } from "node:crypto";
import { OperatorRevert } from "@perplog/chain/signer";
import { type Address, closePriceBound, type MarketInfo, STOP_GIVE_UP_MS } from "@perplog/core";
import {
  bindBotKey,
  claimRequestedBotKeys,
  createBotKeyRequest,
  type Db,
  getStop,
  insertStop,
  listAlerts,
  listStopExecutions,
  type NewStop,
  recordExecution,
  type StopRow,
  transitionStop,
} from "@perplog/db";
import { encryptPrivateKey } from "@perplog/db/crypto";
import { createTestDb } from "@perplog/db/testing";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { createStopEngine } from "../src/stop-engine";
import { fakeLogger, fakeTradingChain } from "./fakes";

const ACCOUNT = `0x${"a1".repeat(20)}` as Address;
const POOL_A = `0x${"b1".repeat(20)}` as Address;
const POOL_B = `0x${"b2".repeat(20)}` as Address;
const TRIGGER = 100_000n;

const market = (pool: Address): MarketInfo => ({
  pool,
  symbol: "X-PERP",
  baseDecimals: 18,
  tickSize: 10n,
  lotSize: 10n,
  minQuantity: 10n,
  stopRegistry: null,
});

const ioc = () => new OperatorRevert("ImmediateOrCancelNoFill");

async function setup(stops: Array<Partial<NewStop>> = [{}]) {
  const db = await createTestDb();
  const kek = randomBytes(32);
  const pk = generatePrivateKey();
  const req = await createBotKeyRequest(db);
  await claimRequestedBotKeys(db, 1, (id) => {
    const { encPk, iv, tag } = encryptPrivateKey(pk, kek, id);
    return { address: privateKeyToAddress(pk).toLowerCase() as Address, encPk, iv, tag };
  });
  await bindBotKey(db, req.id, ACCOUNT, [POOL_A, POOL_B]);
  const rows: StopRow[] = [];
  for (const over of stops) {
    rows.push(
      await insertStop(db, {
        account: ACCOUNT,
        pool: POOL_A,
        botKeyId: req.id,
        positionSide: "long",
        triggerPrice: TRIGGER,
        triggerOp: "lte",
        qtyMode: "entire",
        status: "armed",
        ...over,
      }),
    );
  }
  const f = fakeTradingChain([market(POOL_A), market(POOL_B)]);
  const log = fakeLogger();
  const clock = { t: 1_800_000_000_000 };
  const engine = createStopEngine({ db, chain: f.chain, kek, log, now: () => clock.t });
  /** One polling pass, then wait for every execution it scheduled. */
  const run = async () => {
    await engine.tick();
    await engine.idle();
  };
  /** A fresh engine on the same DB and chain, as after a worker restart (no in-memory state). */
  const restart = () => {
    const e = createStopEngine({ db, chain: f.chain, kek, log, now: () => clock.t });
    return async () => {
      await e.tick();
      await e.idle();
    };
  };
  return { db, pk, keyId: req.id, stops: rows, f, log, clock, engine, run, restart };
}

const stopOf = async (db: Db, id: string): Promise<StopRow> => {
  const s = await getStop(db, id);
  if (!s) throw new Error("stop vanished");
  return s;
};

// Every send is checked by the fake itself (fakes.ts): never while a tx from the key is pending, never more than
// the live size, never on the opening side. A violation fails the test.

test("long stop fires when mark ≤ trigger, closes the whole latest size, ends DONE with a stop_done alert", async () => {
  const { db, pk, f, log, run, stops } = await setup();
  const stop = stops[0] as StopRow;
  f.sizes.set(POOL_A, 1_000n);
  f.marks.set(POOL_A, { price: TRIGGER + 10n, fromIndex: false });
  await run();
  expect((await stopOf(db, stop.id)).status).toBe("armed");
  expect(f.sends).toHaveLength(0);

  // The position grows after the stop was armed: the close must use the size read at send time.
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  f.sizes.set(POOL_A, 1_230n);
  await run();

  expect(f.sends).toHaveLength(1);
  expect(f.sends[0]).toMatchObject({
    privateKey: pk,
    owner: ACCOUNT,
    pool: POOL_A,
    isBid: false,
    qtyRaw: 1_230n,
    priceBound: 98_500n,
  });
  expect(f.sizes.get(POOL_A)).toBe(0n);

  const after = await stopOf(db, stop.id);
  expect(after.status).toBe("done");
  expect(after.closedRaw).toBe(1_230n);
  expect(after.attempts).toBe(1);
  expect(after.triggeredAt).toBeInstanceOf(Date);
  expect(after.finishedAt).toBeInstanceOf(Date);

  const [exec] = await listStopExecutions(db, stop.id);
  expect(exec).toMatchObject({ kind: "stop_close", status: "confirmed", filledRaw: 1_230n, qtyRaw: 1_230n });
  expect(exec?.txHash).toMatch(/^0x/);

  const alerts = await listAlerts(db, ACCOUNT, 0);
  expect(alerts).toHaveLength(1);
  expect(alerts[0]).toMatchObject({ type: "stop_done", pool: POOL_A });
  expect(alerts[0]?.payload).toEqual({
    stopId: stop.id,
    pool: POOL_A,
    txHashes: [exec?.txHash],
    closedRaw: "1230",
  });

  const triggered = log.entries.find((e) => e.msg === "stop_triggered");
  expect(triggered?.obj).toMatchObject({ stopId: stop.id, mark: "100000", trigger: "100000" });
  const sent = log.entries.find((e) => e.msg === "stop_close_sent");
  expect(sent?.obj).toMatchObject({ stopId: stop.id, ms_since_trigger: 0 });
  // No key material in any log line.
  expect(JSON.stringify(log.entries, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toContain(
    pk.slice(2),
  );
});

test("stop_close_sent breaks ms_since_trigger down by step", async () => {
  const { f, log, run, clock } = await setup();
  f.sizes.set(POOL_A, 1_000n);
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  // Time passes only on the chain calls of the execution: the head read and the send.
  const blockNumber = vi.mocked(f.chain.blockNumber);
  const placeMarketFor = vi.mocked(f.chain.placeMarketFor);
  const block = blockNumber.getMockImplementation();
  const place = placeMarketFor.getMockImplementation();
  if (!block || !place) throw new Error("fake chain without implementations");
  blockNumber.mockImplementation(async () => {
    clock.t += 30;
    return block();
  });
  placeMarketFor.mockImplementation(async (...args) => {
    clock.t += 700;
    return { ...(await place(...args)), stepsMs: { simulate: 100, broadcast: 100, receipt: 500 } };
  });
  await run();

  const sent = log.entries.find((e) => e.msg === "stop_close_sent");
  expect(sent?.obj).toMatchObject({
    ms_since_trigger: 730,
    steps_ms: {
      queue: 0,
      claim: 0,
      key: 0,
      fence: 0,
      settle: 0,
      head: 30,
      reads: 0,
      record: 0,
      place: 700,
      persist: 0,
      place_steps: { simulate: 100, broadcast: 100, receipt: 500 },
    },
  });
});

test("short stop sends a bid with a ceiled bound", async () => {
  const { db, f, run, stops } = await setup([{ positionSide: "short", triggerOp: "gte" }]);
  const stop = stops[0] as StopRow;
  f.sizes.set(POOL_A, -500n);
  f.marks.set(POOL_A, { price: TRIGGER - 10n, fromIndex: false });
  await run();
  expect(f.sends).toHaveLength(0);

  f.marks.set(POOL_A, { price: 100_003n, fromIndex: false });
  await run();
  expect(f.sends).toHaveLength(1);
  // 100_003 × 1.015 = 101_503.045 → ceil 101_504 → next tick of 10 → 101_510
  expect(f.sends[0]).toMatchObject({ isBid: true, qtyRaw: 500n, priceBound: 101_510n });
  expect(f.sends[0]?.priceBound).toBe(closePriceBound(100_003n, "short", 150, 10n));
  expect(f.sizes.get(POOL_A)).toBe(0n);
  expect((await stopOf(db, stop.id)).status).toBe("done");
});

test("a failed mark read never triggers", async () => {
  const { db, f, log, run, stops } = await setup([{ pool: POOL_A }, { pool: POOL_B }]);
  const [a, b] = stops as [StopRow, StopRow];
  f.sizes.set(POOL_A, 1_000n);
  f.sizes.set(POOL_B, 1_000n);
  f.marks.set(POOL_A, new Error("getPerpState reverted"));
  f.marks.set(POOL_B, { price: TRIGGER - 1n, fromIndex: false });
  await run();

  const failed = log.entries.find((e) => e.msg === "mark_read_failed");
  expect(failed?.obj.pool).toBe(POOL_A);
  const sa = await stopOf(db, a.id);
  expect(sa.status).toBe("armed");
  expect(sa.triggeredAt).toBeNull();
  expect(f.calls).not.toContain(`size:${POOL_A}`);
  expect(f.sends.map((s) => s.pool)).toEqual([POOL_B]);
  // The other pool's read is independent and still evaluated.
  expect((await stopOf(db, b.id)).status).toBe("done");
});

test("stale mark (fromIndex) still evaluates and logs stale_mark", async () => {
  const { db, f, log, run, stops } = await setup();
  const stop = stops[0] as StopRow;
  f.sizes.set(POOL_A, 1_000n);
  f.marks.set(POOL_A, { price: TRIGGER - 500n, fromIndex: true });
  await run();
  const stale = log.entries.find((e) => e.msg === "stale_mark");
  expect(stale?.obj.pool).toBe(POOL_A);
  expect(log.has("stop_triggered")).toBe(true);
  expect(f.sends).toHaveLength(1);
  expect((await stopOf(db, stop.id)).status).toBe("done");
});

test("position closed manually after trigger → DONE without sending any order", async () => {
  const { db, f, run, stops } = await setup();
  const stop = stops[0] as StopRow;
  f.sizes.set(POOL_A, 1_000n);
  f.chain.readMark = vi.fn(async () => {
    f.sizes.set(POOL_A, 0n); // the user's own close lands right after the mark read
    return { price: TRIGGER - 1n, fromIndex: false };
  });
  await run();
  expect(f.sends).toHaveLength(0);
  const after = await stopOf(db, stop.id);
  expect(after.status).toBe("done");
  expect(after.closedRaw).toBe(0n);
  expect(after.attempts).toBe(0);
  const alerts = await listAlerts(db, ACCOUNT, 0);
  expect(alerts.map((a) => a.type)).toEqual(["stop_done"]);
  expect(alerts[0]?.payload).toMatchObject({ txHashes: [], closedRaw: "0" });
});

test("position flipped after trigger → CANCELLED without sending any order", async () => {
  const { db, f, run, stops } = await setup();
  const stop = stops[0] as StopRow;
  f.sizes.set(POOL_A, 1_000n);
  f.chain.readMark = vi.fn(async () => {
    f.sizes.set(POOL_A, -300n);
    return { price: TRIGGER - 1n, fromIndex: false };
  });
  await run();
  expect(f.sends).toHaveLength(0);
  expect((await stopOf(db, stop.id)).status).toBe("cancelled");
  expect(f.sizes.get(POOL_A)).toBe(-300n);
  expect(await listAlerts(db, ACCOUNT, 0)).toHaveLength(0);
});

test("IOC no-fill widens slip 150 → 250 → 350 and then fills", async () => {
  const { db, f, run, stops } = await setup();
  const stop = stops[0] as StopRow;
  f.sizes.set(POOL_A, 1_000n);
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  f.script.push(ioc(), ioc(), "fill");
  await run();
  expect(f.sends.map((s) => s.priceBound)).toEqual([98_500n, 97_500n, 96_500n]);
  expect(f.sends.map((s) => s.qtyRaw)).toEqual([1_000n, 1_000n, 1_000n]);
  const after = await stopOf(db, stop.id);
  expect(after.status).toBe("done");
  expect(after.attempts).toBe(3);
  expect(after.closedRaw).toBe(1_000n);
  const execs = await listStopExecutions(db, stop.id);
  expect(execs.map((e) => [e.status, e.error])).toEqual([
    ["failed", "ImmediateOrCancelNoFill"],
    ["failed", "ImmediateOrCancelNoFill"],
    ["confirmed", null],
  ]);
});

test("five failed attempts → FAILED with stop_failed alert", async () => {
  const { db, f, run, stops } = await setup();
  const stop = stops[0] as StopRow;
  f.sizes.set(POOL_A, 1_000n);
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  // any error thrown before broadcast (here a failed simulation RPC) is a plain failed attempt: safe to retry
  f.script.push(ioc(), new Error("simulate: fetch failed"), ioc(), ioc(), ioc(), "fill");
  await run();
  expect(f.sends).toHaveLength(5);
  // slip 150, 250, 350, 450, then capped at the stop's max of 500
  expect(f.sends.map((s) => s.priceBound)).toEqual([98_500n, 97_500n, 96_500n, 95_500n, 95_000n]);
  const after = await stopOf(db, stop.id);
  expect(after.status).toBe("failed");
  expect(after.attempts).toBe(5);
  expect(after.lastError).toBe("ImmediateOrCancelNoFill");
  expect(f.sizes.get(POOL_A)).toBe(1_000n);
  const alerts = await listAlerts(db, ACCOUNT, 0);
  expect(alerts.map((a) => a.type)).toEqual(["stop_failed"]);
  expect(alerts[0]?.payload).toMatchObject({ stopId: stop.id, reason: "ImmediateOrCancelNoFill" });
  // A terminal stop is never picked up again.
  await run();
  expect(f.sends).toHaveLength(5);
});

test("give-up after 15s since trigger even with attempts left", async () => {
  const { db, f, clock, run, stops } = await setup();
  const stop = stops[0] as StopRow;
  f.sizes.set(POOL_A, 1_000n);
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  f.script.push(async () => {
    clock.t += STOP_GIVE_UP_MS + 1;
    throw ioc();
  });
  await run();
  expect(f.sends).toHaveLength(1);
  const after = await stopOf(db, stop.id);
  expect(after.status).toBe("failed");
  expect(after.attempts).toBe(1);
  expect((await listAlerts(db, ACCOUNT, 0)).map((a) => a.type)).toEqual(["stop_failed"]);
});

test("partial fill sends the remainder next attempt, never more than the live size", async () => {
  const { db, f, run, stops } = await setup();
  const stop = stops[0] as StopRow;
  f.sizes.set(POOL_A, 1_000n);
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  f.script.push(async () => {
    // 400 fills, and meanwhile the user's own reduce of 100 lands.
    f.sizes.set(POOL_A, (f.sizes.get(POOL_A) as bigint) - 100n);
    return 400n;
  });
  await run();
  expect(f.sends.map((s) => s.qtyRaw)).toEqual([1_000n, 500n]);
  expect(f.sizes.get(POOL_A)).toBe(0n);
  const after = await stopOf(db, stop.id);
  expect(after.status).toBe("done");
  expect(after.closedRaw).toBe(900n);
  expect(after.attempts).toBe(2);
  const [alert] = await listAlerts(db, ACCOUNT, 0);
  expect(alert?.payload.txHashes).toHaveLength(2);
});

test("fixed-quantity stop closes only its quantity across partial fills", async () => {
  const { db, f, run, stops } = await setup([{ qtyMode: "fixed", qtyRaw: 600n }]);
  const stop = stops[0] as StopRow;
  f.sizes.set(POOL_A, 1_000n);
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  f.script.push({ fill: 200n });
  await run();
  expect(f.sends.map((s) => s.qtyRaw)).toEqual([600n, 400n]);
  expect(f.sizes.get(POOL_A)).toBe(400n);
  const after = await stopOf(db, stop.id);
  expect(after.status).toBe("done");
  expect(after.closedRaw).toBe(600n);
});

test("restart: a stop left 'executing' resumes by re-reading the size first", async () => {
  const { db, f, clock, run, stops } = await setup([
    { pool: POOL_A, status: "executing", attempts: 2, closedRaw: 300n },
    { pool: POOL_B, status: "triggered" },
  ]);
  const [a, b] = stops as [StopRow, StopRow];
  for (const s of [a, b]) {
    await transitionStop(db, s.id, [s.status], s.status, { triggeredAt: new Date(clock.t - 2_000) });
  }
  f.sizes.set(POOL_A, 700n);
  f.sizes.set(POOL_B, 0n); // closed while the worker was down
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  f.marks.set(POOL_B, { price: TRIGGER, fromIndex: false });
  await run();

  const firstSize = f.calls.indexOf(`size:${POOL_A}`);
  const firstSend = f.calls.indexOf(`send:${POOL_A}`);
  expect(firstSize).toBeGreaterThanOrEqual(0);
  expect(firstSize).toBeLessThan(firstSend);
  // attempt 2 → slip 350 bps
  expect(f.sends).toHaveLength(1);
  expect(f.sends[0]).toMatchObject({ pool: POOL_A, qtyRaw: 700n, priceBound: 96_500n });
  const sa = await stopOf(db, a.id);
  expect(sa.status).toBe("done");
  expect(sa.attempts).toBe(3);
  expect(sa.closedRaw).toBe(1_000n);
  expect((await stopOf(db, b.id)).status).toBe("done");
  expect(f.calls).not.toContain(`send:${POOL_B}`);
});

test("cancelled between tick and execute → nothing is sent", async () => {
  const { db, f, run, stops } = await setup([{ status: "triggered" }]);
  const stop = stops[0] as StopRow;
  f.sizes.set(POOL_A, 1_000n);
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  const markets = f.chain.markets;
  f.chain.markets = vi.fn(async () => {
    // lands after the tick listed the stop and before execute claims it
    await transitionStop(db, stop.id, ["triggered"], "cancelled");
    return markets();
  });
  await run();
  expect(f.sends).toHaveLength(0);
  expect(f.calls).not.toContain(`size:${POOL_A}`);
  expect((await stopOf(db, stop.id)).status).toBe("cancelled");
});

test("an armed stop cancelled after the mark read is not triggered", async () => {
  const { db, f, log, run, stops } = await setup();
  const stop = stops[0] as StopRow;
  f.sizes.set(POOL_A, 1_000n);
  f.chain.readMark = vi.fn(async () => {
    await transitionStop(db, stop.id, ["armed"], "cancelled");
    return { price: TRIGGER - 1n, fromIndex: false };
  });
  await run();
  expect(f.sends).toHaveLength(0);
  expect(log.has("stop_triggered")).toBe(false);
  expect((await stopOf(db, stop.id)).status).toBe("cancelled");
});

test("two stops on one bot key execute sequentially", async () => {
  const { db, f, engine, stops } = await setup([{ pool: POOL_A }, { pool: POOL_B }]);
  f.sizes.set(POOL_A, 1_000n);
  f.sizes.set(POOL_B, 2_000n);
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  f.marks.set(POOL_B, { price: TRIGGER, fromIndex: false });
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  f.script.push(async (p) => {
    await gate;
    return p.qtyRaw;
  });

  await engine.tick();
  await vi.waitFor(() => expect(f.sends).toHaveLength(1));
  const first = f.sends[0]?.pool as Address;
  const second = first === POOL_A ? POOL_B : POOL_A;
  // While the first close is in flight the second stop has not even read its size.
  await new Promise((r) => setTimeout(r, 20));
  expect(f.calls).not.toContain(`size:${second}`);
  // Further ticks while busy must not start a second execution of either stop.
  await engine.tick();
  await engine.tick();
  expect(f.sends).toHaveLength(1);

  release();
  await engine.idle();
  expect(f.sends.map((s) => s.pool)).toEqual([first, second]);
  expect(f.calls.indexOf(`size:${second}`)).toBeGreaterThan(f.calls.indexOf(`send:${first}`));
  for (const s of stops) expect((await stopOf(db, s.id)).status).toBe("done");
});

test("a failed size read sends nothing and the stop resumes on a later tick", async () => {
  const { db, f, log, run, stops } = await setup();
  const stop = stops[0] as StopRow;
  f.sizes.set(POOL_A, new Error("rpc down"));
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  await run();
  expect(f.sends).toHaveLength(0);
  const mid = await stopOf(db, stop.id);
  expect(mid.status).toBe("executing");
  expect(mid.attempts).toBe(0);
  expect(mid.lastError).toMatch(/size_read_failed/);
  expect(log.entries.some((e) => e.level === "warn" && e.obj.stopId === stop.id)).toBe(true);

  f.sizes.set(POOL_A, 1_000n);
  await run();
  expect(f.sends).toHaveLength(1);
  expect((await stopOf(db, stop.id)).status).toBe("done");
});

test("a size read still failing 15s after the trigger gives up", async () => {
  const { db, f, clock, run, stops } = await setup();
  const stop = stops[0] as StopRow;
  f.sizes.set(POOL_A, new Error("rpc down"));
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  await run();
  clock.t += STOP_GIVE_UP_MS + 1;
  await run();
  expect(f.sends).toHaveLength(0);
  const after = await stopOf(db, stop.id);
  expect(after.status).toBe("failed");
  expect(after.lastError).toMatch(/size_read_failed/);
  expect((await listAlerts(db, ACCOUNT, 0)).map((a) => a.type)).toEqual(["stop_failed"]);
});

test("a position too small to place ends FAILED with dust_position", async () => {
  const { db, f, run, stops } = await setup();
  const stop = stops[0] as StopRow;
  f.sizes.set(POOL_A, 5n); // below minQuantity 10
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  await run();
  expect(f.sends).toHaveLength(0);
  const after = await stopOf(db, stop.id);
  expect(after.status).toBe("failed");
  expect(after.lastError).toBe("dust_position");
  const alerts = await listAlerts(db, ACCOUNT, 0);
  expect(alerts.map((a) => a.type)).toEqual(["stop_failed"]);
  expect(alerts[0]?.payload).toMatchObject({ reason: "dust_position" });
});

test("stop() lets the in-flight attempt finish, sends nothing more and leaves the stop to resume", async () => {
  const { db, f, engine, stops } = await setup();
  const stop = stops[0] as StopRow;
  f.sizes.set(POOL_A, 1_000n);
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  f.script.push(async () => {
    await gate;
    throw ioc();
  });
  await engine.tick();
  await vi.waitFor(() => expect(f.sends).toHaveLength(1));
  const stopped = engine.stop();
  release();
  await stopped;
  expect(f.sends).toHaveLength(1);
  const after = await stopOf(db, stop.id);
  expect(after.status).toBe("executing");
  expect(after.attempts).toBe(1);
  // A stopped engine's tick is a no-op.
  await engine.tick();
  await engine.idle();
  expect(f.sends).toHaveLength(1);
});

test("a fill on the fifth and last attempt ends DONE, not FAILED", async () => {
  const { db, f, run, stops } = await setup();
  const stop = stops[0] as StopRow;
  f.sizes.set(POOL_A, 1_000n);
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  f.script.push(ioc(), ioc(), ioc(), ioc(), "fill");
  await run();
  expect(f.sends).toHaveLength(5);
  const after = await stopOf(db, stop.id);
  expect(after.status).toBe("done");
  expect(after.attempts).toBe(5);
  expect(after.lastError).toBeNull();
  expect((await listAlerts(db, ACCOUNT, 0)).map((a) => a.type)).toEqual(["stop_done"]);
});

// ---- Outcome unknown: a tx that may have been broadcast is never followed by a blind resend ----

test("an unknown outcome is never resent: once the receipt is visible the stop ends DONE with no flip", async () => {
  const { db, f, run, stops } = await setup();
  const stop = stops[0] as StopRow;
  f.sizes.set(POOL_A, 1_000n);
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  f.script.push({ unknown: 1_000n });
  await run();
  expect(f.sends).toHaveLength(1);
  let mid = await stopOf(db, stop.id);
  expect(mid.status).toBe("executing");
  expect(mid.lastError).toBe("outcome_unknown");
  const [sent] = await listStopExecutions(db, stop.id);
  expect(sent?.status).toBe("sent");
  expect(sent?.txHash).toMatch(/^0x/);

  // Still pending: further ticks resend nothing (the fake would also flag a send while pending).
  await run();
  await run();
  expect(f.sends).toHaveLength(1);
  mid = await stopOf(db, stop.id);
  expect(mid.status).toBe("executing");

  f.mine();
  await run();
  expect(f.sends).toHaveLength(1);
  expect(f.sizes.get(POOL_A)).toBe(0n);
  const after = await stopOf(db, stop.id);
  expect(after.status).toBe("done");
  expect(after.closedRaw).toBe(1_000n);
  const [exec] = await listStopExecutions(db, stop.id);
  expect(exec).toMatchObject({ status: "confirmed", filledRaw: 1_000n, txHash: sent?.txHash });
  const alerts = await listAlerts(db, ACCOUNT, 0);
  expect(alerts.map((a) => a.type)).toEqual(["stop_done"]);
  expect(alerts[0]?.payload.txHashes).toEqual([sent?.txHash]);
});

test("an unknown outcome that partly filled is recorded, then only the fresh remainder is sent", async () => {
  const { db, f, run, stops } = await setup();
  const stop = stops[0] as StopRow;
  f.sizes.set(POOL_A, 1_000n);
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  f.script.push({ unknown: 400n });
  await run();
  f.mine();
  await run();
  expect(f.sends.map((s) => s.qtyRaw)).toEqual([1_000n, 600n]);
  expect(f.sizes.get(POOL_A)).toBe(0n);
  const after = await stopOf(db, stop.id);
  expect(after.status).toBe("done");
  expect(after.closedRaw).toBe(1_000n);
  expect((await listStopExecutions(db, stop.id)).map((e) => [e.status, e.filledRaw])).toEqual([
    ["confirmed", 400n],
    ["confirmed", 600n],
  ]);
});

test("an unknown outcome without a hash waits for the bot's pending nonce, then trusts the fresh size", async () => {
  const { db, f, run, stops } = await setup();
  const stop = stops[0] as StopRow;
  f.sizes.set(POOL_A, 1_000n);
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  f.script.push({ unknown: 1_000n, withHash: false });
  await run();
  await run();
  expect(f.sends).toHaveLength(1);
  expect((await stopOf(db, stop.id)).status).toBe("executing");
  f.mine();
  // Settled with no receipt to fence on: the size is trusted only once a block past the settle is visible.
  await run();
  expect((await stopOf(db, stop.id)).lastError).toBe("block_fence");
  f.advance();
  await run();
  expect(f.sends).toHaveLength(1);
  expect(f.sizes.get(POOL_A)).toBe(0n);
  expect((await stopOf(db, stop.id)).status).toBe("done");
});

test("a dropped tx (hash, no receipt, nothing pending) is marked dropped and the close proceeds", async () => {
  const { db, f, run, stops } = await setup();
  const stop = stops[0] as StopRow;
  f.sizes.set(POOL_A, 1_000n);
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  f.script.push({ unknown: 1_000n });
  await run();
  f.drop();
  await run();
  expect(f.sends).toHaveLength(1);
  f.advance();
  await run();
  expect(f.sends.map((s) => s.qtyRaw)).toEqual([1_000n, 1_000n]);
  expect(f.sizes.get(POOL_A)).toBe(0n);
  expect((await stopOf(db, stop.id)).status).toBe("done");
  expect((await listStopExecutions(db, stop.id)).map((e) => [e.status, e.error])).toEqual([
    ["failed", "dropped"],
    ["confirmed", null],
  ]);
});

test("an outcome that never resolves ends FAILED with outcome_unknown 15s after the trigger", async () => {
  const { db, f, clock, run, stops } = await setup();
  const stop = stops[0] as StopRow;
  f.sizes.set(POOL_A, 1_000n);
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  f.script.push({ unknown: 1_000n });
  await run();
  clock.t += 5_000;
  await run();
  expect((await stopOf(db, stop.id)).status).toBe("executing");
  clock.t += STOP_GIVE_UP_MS;
  await run();
  expect(f.sends).toHaveLength(1);
  const after = await stopOf(db, stop.id);
  expect(after.status).toBe("failed");
  expect(after.lastError).toBe("outcome_unknown");
  const alerts = await listAlerts(db, ACCOUNT, 0);
  expect(alerts.map((a) => a.type)).toEqual(["stop_failed"]);
  expect(alerts[0]?.payload).toMatchObject({ reason: "outcome_unknown" });
});

test("restart: an execution left 'sending' with a pending nonce sends nothing until it resolves", async () => {
  const { db, f, clock, run, stops, keyId } = await setup([{ status: "executing", attempts: 1 }]);
  const stop = stops[0] as StopRow;
  await transitionStop(db, stop.id, ["executing"], "executing", { triggeredAt: new Date(clock.t - 1_000) });
  // The previous process crashed between recording the execution and learning its outcome.
  await recordExecution(db, {
    kind: "stop_close",
    status: "sending",
    account: ACCOUNT,
    pool: POOL_A,
    botKeyId: keyId,
    stopId: stop.id,
    isBid: false,
    qtyRaw: 1_000n,
    priceBound: 97_500n,
  });
  f.sizes.set(POOL_A, 1_000n);
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  f.state.externalPending = true;
  await run();
  await run();
  expect(f.sends).toHaveLength(0);
  expect((await stopOf(db, stop.id)).status).toBe("executing");

  // It lands: the nonce is no longer pending and the size reflects the fill.
  f.state.externalPending = false;
  f.sizes.set(POOL_A, 0n);
  await run();
  f.advance();
  await run();
  expect(f.sends).toHaveLength(0);
  expect((await stopOf(db, stop.id)).status).toBe("done");
  expect((await listStopExecutions(db, stop.id))[0]?.status).toBe("failed");
});

test("restart: an execution left 'sending' that never went out lets the close proceed on the fresh size", async () => {
  const { db, f, clock, run, stops, keyId } = await setup([{ status: "executing", attempts: 1 }]);
  const stop = stops[0] as StopRow;
  await transitionStop(db, stop.id, ["executing"], "executing", { triggeredAt: new Date(clock.t - 1_000) });
  await recordExecution(db, {
    kind: "stop_close",
    status: "sending",
    account: ACCOUNT,
    pool: POOL_A,
    botKeyId: keyId,
    stopId: stop.id,
    isBid: false,
    qtyRaw: 1_000n,
    priceBound: 97_500n,
  });
  f.sizes.set(POOL_A, 800n);
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  await run();
  expect(f.sends).toHaveLength(0);
  f.advance();
  await run();
  expect(f.sends.map((s) => s.qtyRaw)).toEqual([800n]);
  expect((await stopOf(db, stop.id)).status).toBe("done");
});

test("a failed pending-nonce check sends nothing", async () => {
  const { db, f, run, stops } = await setup();
  const stop = stops[0] as StopRow;
  f.sizes.set(POOL_A, 1_000n);
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  f.chain.hasPendingTx = vi.fn(async () => Promise.reject(new Error("HTTP 503")));
  await run();
  expect(f.sends).toHaveLength(0);
  const mid = await stopOf(db, stop.id);
  expect(mid.status).toBe("executing");
  expect(mid.lastError).toMatch(/pending_check_failed/);
});

// ---- Block fence: a size read is trusted only on a node that has seen every known fill ----

test("a receipt seen while the size view lags a block: no resend, DONE once the view catches up", async () => {
  const { db, f, run, stops } = await setup();
  const stop = stops[0] as StopRow;
  f.sizes.set(POOL_A, 1_000n);
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  f.script.push({ unknown: 1_000n });
  await run();
  f.state.lag = 1n; // the receipt is visible, but the size node is still on the block before the fill
  f.mine();
  await run();
  await run();
  expect(f.sends).toHaveLength(1);
  const mid = await stopOf(db, stop.id);
  expect(mid.status).toBe("executing");
  expect(mid.closedRaw).toBe(1_000n);
  expect(mid.lastError).toBe("block_fence");
  f.state.lag = 0n;
  await run();
  expect(f.sends).toHaveLength(1);
  expect(f.sizes.get(POOL_A)).toBe(0n);
  expect((await stopOf(db, stop.id)).status).toBe("done");
});

test("the success path fences too: after a partial fill the remainder waits for the fill's block", async () => {
  const { db, f, run, stops } = await setup();
  const stop = stops[0] as StopRow;
  f.sizes.set(POOL_A, 1_000n);
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  f.state.lag = 1n;
  f.script.push({ fill: 400n });
  await run();
  expect(f.sends.map((s) => s.qtyRaw)).toEqual([1_000n]);
  expect((await stopOf(db, stop.id)).lastError).toBe("block_fence");
  f.state.lag = 0n;
  await run();
  expect(f.sends.map((s) => s.qtyRaw)).toEqual([1_000n, 600n]);
  expect(f.sizes.get(POOL_A)).toBe(0n);
  expect((await stopOf(db, stop.id)).status).toBe("done");
});

test("after a restart the fence is re-derived from the last recorded receipt", async () => {
  const { db, f, run, restart, stops } = await setup();
  const stop = stops[0] as StopRow;
  f.sizes.set(POOL_A, 1_000n);
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  f.state.lag = 1n;
  f.script.push({ fill: 400n });
  await run();
  expect(f.sends).toHaveLength(1);
  // A new process has no in-memory fence; the size node still lags.
  const runAgain = restart();
  await runAgain();
  await runAgain();
  expect(f.sends).toHaveLength(1);
  expect((await stopOf(db, stop.id)).status).toBe("executing");
  f.state.lag = 0n;
  await runAgain();
  expect(f.sends.map((s) => s.qtyRaw)).toEqual([1_000n, 600n]);
  expect((await stopOf(db, stop.id)).status).toBe("done");
});

test("a failed block-number read sends nothing", async () => {
  const { db, f, run, stops } = await setup();
  const stop = stops[0] as StopRow;
  f.sizes.set(POOL_A, 1_000n);
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  f.state.blockError = new Error("HTTP 503");
  await run();
  expect(f.sends).toHaveLength(0);
  const mid = await stopOf(db, stop.id);
  expect(mid.status).toBe("executing");
  expect(mid.attempts).toBe(0);
  expect(mid.lastError).toMatch(/block_read_failed/);
  f.state.blockError = null;
  await run();
  expect((await stopOf(db, stop.id)).status).toBe("done");
});

test("every size read before a send is pinned to a block the node has", async () => {
  const { f, run } = await setup();
  f.sizes.set(POOL_A, 1_000n);
  f.marks.set(POOL_A, { price: TRIGGER, fromIndex: false });
  await run();
  const sizeCalls = vi.mocked(f.chain.readPositionSize).mock.calls;
  expect(sizeCalls.length).toBeGreaterThan(0);
  for (const call of sizeCalls) expect(typeof call[2]).toBe("bigint");
});
