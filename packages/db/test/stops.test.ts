import type { Address } from "@perplog/core";
import {
  createBotKeyRequest,
  insertStop,
  listAccountStops,
  listStops,
  type NewStop,
  recordExecution,
  stopCloseTxHashes,
  transitionStop,
  updateExecution,
} from "../src";
import { createTestDb } from "../src/testing";

const ACCOUNT = `0x${"a1".repeat(20)}` as Address;
const POOL = `0x${"b2".repeat(20)}` as Address;
const POOL2 = `0x${"b3".repeat(20)}` as Address;

async function setup() {
  const db = await createTestDb();
  const key = await createBotKeyRequest(db);
  const armedStop = (over: Partial<NewStop> = {}): NewStop => ({
    account: ACCOUNT,
    pool: POOL,
    botKeyId: key.id,
    positionSide: "long",
    triggerPrice: 1000n,
    triggerOp: "lte",
    qtyMode: "entire",
    status: "armed",
    ...over,
  });
  return { db, key, armedStop };
}

test("transitionStop only moves from the expected status", async () => {
  const { db, armedStop } = await setup();
  const s = await insertStop(db, armedStop());
  expect(await transitionStop(db, s.id, ["armed"], "triggered", { triggeredAt: new Date() })).toBe(true);
  expect(await transitionStop(db, s.id, ["armed", "paused"], "cancelled")).toBe(false);
  const [row] = await listStops(db, ["triggered"]);
  expect(row?.triggeredAt).toBeInstanceOf(Date);
  expect(row?.finishedAt).toBeNull();
});

test("terminal transitions set finished_at", async () => {
  const { db, armedStop } = await setup();
  const s = await insertStop(db, armedStop());
  expect(await transitionStop(db, s.id, ["armed"], "cancelled")).toBe(true);
  const [row] = await listStops(db, ["cancelled"]);
  expect(row?.finishedAt).toBeInstanceOf(Date);
});

test("insertStop replaces the previous active stop on the same pool", async () => {
  const { db, armedStop } = await setup();
  const a = await insertStop(db, armedStop());
  const other = await insertStop(db, armedStop({ pool: POOL2 }));
  const b = await insertStop(db, armedStop());
  expect((await listAccountStops(db, ACCOUNT, ["armed"])).map((s) => s.id).sort()).toEqual(
    [b.id, other.id].sort(),
  );
  expect((await listStops(db, ["cancelled"])).map((s) => s.id)).toEqual([a.id]);
  expect((await listStops(db, ["cancelled"]))[0]?.finishedAt).toBeInstanceOf(Date);
});

test("insertStop leaves triggered/executing stops alone", async () => {
  const { db, armedStop } = await setup();
  const a = await insertStop(db, armedStop());
  await transitionStop(db, a.id, ["armed"], "triggered");
  await insertStop(db, armedStop());
  expect((await listStops(db, ["triggered"])).map((s) => s.id)).toEqual([a.id]);
});

test("numeric columns round-trip 78-digit bigints", async () => {
  const { db, armedStop } = await setup();
  await insertStop(db, armedStop({ triggerPrice: 10n ** 77n }));
  const row = (await listStops(db, ["armed"]))[0];
  expect(row?.triggerPrice).toBe(10n ** 77n);
  expect(row?.closedRaw).toBe(0n);
  expect(row?.qtyRaw).toBeNull();
  expect(row?.maxSlipBps).toBe(500);
  expect(row?.source).toBe("protect_now");
});

test("executions are recorded, updated and their tx hashes listed per account", async () => {
  const { db, key, armedStop } = await setup();
  const s = await insertStop(db, armedStop());
  const id = await recordExecution(db, {
    kind: "stop_close",
    status: "sending",
    account: ACCOUNT,
    pool: POOL,
    botKeyId: key.id,
    stopId: s.id,
    isBid: false,
    qtyRaw: 5n,
    priceBound: 10n ** 30n,
  });
  expect(await stopCloseTxHashes(db, ACCOUNT)).toEqual(new Set());
  await updateExecution(db, id, { status: "confirmed", txHash: "0xabc", filledRaw: 5n });
  expect(await stopCloseTxHashes(db, ACCOUNT)).toEqual(new Set(["0xabc"]));
  expect(await stopCloseTxHashes(db, POOL)).toEqual(new Set());
});
