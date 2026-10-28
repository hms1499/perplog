import type { Address } from "@perplog/core";
import {
  claimQueuedEntries,
  createBotKeyRequest,
  createPlanWithEntry,
  getPlan,
  getStop,
  insertStop,
  listAlerts,
  listEvidence,
  listStopExecutions,
  medianStopLatencyMs,
  type NewPlanInput,
  recordExecution,
  requeueEntry,
  settleEntryFailed,
  settleEntryFilled,
  updateExecution,
} from "../src";
import { createTestDb } from "../src/testing";

const ACCOUNT = `0x${"a1".repeat(20)}` as Address;
const OTHER = `0x${"a2".repeat(20)}` as Address;
const POOL = `0x${"b2".repeat(20)}` as Address;
const POOL2 = `0x${"b3".repeat(20)}` as Address;
const HASH = `0x${"cd".repeat(32)}`;

async function setup() {
  const db = await createTestDb();
  const key = await createBotKeyRequest(db);
  const input = (over: Partial<NewPlanInput> = {}): NewPlanInput => ({
    account: ACCOUNT,
    pool: POOL,
    botKeyId: key.id,
    side: "long",
    riskRaw: 25n * 10n ** 18n,
    refPrice: 64_248n * 10n ** 18n,
    stopPrice: 63_900n * 10n ** 18n,
    qtyRaw: 7_183_000n,
    priceBound: 64_569n * 10n ** 18n,
    leverageEstBps: 46_000n,
    liqPriceEst: 58_410n * 10n ** 18n,
    ...over,
  });
  return { db, key, input };
}

const fill = (filledRaw: bigint) => ({
  txHash: HASH,
  orderId: 7n,
  filledRaw,
  avgPrice: 64_251n * 10n ** 18n,
  gasUsed: 1_234n,
});

test("createPlanWithEntry inserts a pending plan and a queued entry", async () => {
  const { db, input } = await setup();
  const created = await createPlanWithEntry(db, input());
  if (!created) throw new Error("expected a plan");
  expect(created.plan).toMatchObject({ status: "pending_entry", qtyRaw: 7_183_000n, stopId: null });
  expect(created.plan.entryExecutionId).toBe(created.executionId);
  const [entry] = await claimQueuedEntries(db, 10);
  expect(entry).toMatchObject({
    id: created.executionId,
    kind: "entry",
    status: "sending",
    planId: created.plan.id,
    isBid: true,
    qtyRaw: 7_183_000n,
    priceBound: 64_569n * 10n ** 18n,
  });
});

test("a short plan's entry is an ask", async () => {
  const { db, input } = await setup();
  const created = await createPlanWithEntry(db, input({ side: "short", stopPrice: 65_000n * 10n ** 18n }));
  const [entry] = await claimQueuedEntries(db, 10);
  expect(entry?.id).toBe(created?.executionId);
  expect(entry?.isBid).toBe(false);
});

test("a second pending plan on the same account and pool returns null", async () => {
  const { db, input } = await setup();
  expect(await createPlanWithEntry(db, input())).not.toBeNull();
  expect(await createPlanWithEntry(db, input())).toBeNull();
  // Another pool, or another account, is fine.
  expect(await createPlanWithEntry(db, input({ pool: POOL2 }))).not.toBeNull();
  expect(await createPlanWithEntry(db, input({ account: OTHER }))).not.toBeNull();
});

test("claimQueuedEntries claims each row once", async () => {
  const { db, input } = await setup();
  await createPlanWithEntry(db, input());
  await createPlanWithEntry(db, input({ pool: POOL2 }));
  const [a, b] = await Promise.all([claimQueuedEntries(db, 10), claimQueuedEntries(db, 10)]);
  const ids = [...(a ?? []), ...(b ?? [])].map((e) => e.id);
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
  expect(await claimQueuedEntries(db, 10)).toEqual([]);
});

test("requeueEntry moves a claimed entry back to queued once", async () => {
  const { db, input } = await setup();
  const created = await createPlanWithEntry(db, input());
  await claimQueuedEntries(db, 10);
  expect(await requeueEntry(db, created?.executionId ?? "")).toBe(true);
  expect(await requeueEntry(db, created?.executionId ?? "")).toBe(false);
  expect((await claimQueuedEntries(db, 10)).map((e) => e.id)).toEqual([created?.executionId]);
});

test("settleEntryFilled arms a plan stop and marks the plan entered; a partial fill is partially_entered", async () => {
  const { db, input } = await setup();
  const full = await createPlanWithEntry(db, input());
  const part = await createPlanWithEntry(
    db,
    input({ pool: POOL2, side: "short", stopPrice: 65_000n * 10n ** 18n }),
  );
  if (!full || !part) throw new Error("expected plans");
  await claimQueuedEntries(db, 10);

  expect(await settleEntryFilled(db, { executionId: full.executionId, fill: fill(7_183_000n) })).toBe(true);
  expect(await settleEntryFilled(db, { executionId: part.executionId, fill: fill(3_000_000n) })).toBe(true);

  const fullPlan = await getPlan(db, full.plan.id);
  expect(fullPlan?.status).toBe("entered");
  const stop = await getStop(db, fullPlan?.stopId ?? "");
  expect(stop).toMatchObject({
    account: ACCOUNT,
    pool: POOL,
    positionSide: "long",
    triggerPrice: 63_900n * 10n ** 18n,
    triggerOp: "lte",
    qtyMode: "entire",
    source: "plan",
    status: "armed",
  });

  const partPlan = await getPlan(db, part.plan.id);
  expect(partPlan?.status).toBe("partially_entered");
  expect(await getStop(db, partPlan?.stopId ?? "")).toMatchObject({
    positionSide: "short",
    triggerOp: "gte",
    triggerPrice: 65_000n * 10n ** 18n,
  });

  // The entry is linked to its stop, so the stop engine fences size reads on the entry's block.
  expect((await listStopExecutions(db, fullPlan?.stopId ?? "")).map((e) => e.id)).toEqual([full.executionId]);

  const [evidence] = await listEvidence(db, { account: ACCOUNT });
  expect(evidence).toMatchObject({ status: "confirmed", txHash: HASH, filledRaw: 3_000_000n, orderId: 7n });
});

test("settleEntryFilled on a plan that left pending_entry returns false and inserts no stop", async () => {
  const { db, input } = await setup();
  const created = await createPlanWithEntry(db, input());
  if (!created) throw new Error("expected a plan");
  expect(await settleEntryFailed(db, { executionId: created.executionId, error: "expired" })).toBe(true);
  expect(await settleEntryFilled(db, { executionId: created.executionId, fill: fill(7_183_000n) })).toBe(
    false,
  );
  const plan = await getPlan(db, created.plan.id);
  expect(plan).toMatchObject({ status: "entry_failed", stopId: null });
});

test("settleEntryFailed marks the plan entry_failed and inserts one entry_failed alert", async () => {
  const { db, input } = await setup();
  const created = await createPlanWithEntry(db, input());
  if (!created) throw new Error("expected a plan");
  expect(
    await settleEntryFailed(db, { executionId: created.executionId, error: "no_fill", txHash: HASH }),
  ).toBe(true);
  expect(await settleEntryFailed(db, { executionId: created.executionId, error: "no_fill" })).toBe(false);
  expect((await getPlan(db, created.plan.id))?.status).toBe("entry_failed");
  const alerts = await listAlerts(db, ACCOUNT, 0);
  expect(alerts).toHaveLength(1);
  expect(alerts[0]).toMatchObject({
    type: "entry_failed",
    pool: POOL,
    payload: { planId: created.plan.id, pool: POOL, reason: "no_fill" },
  });
  // The failed entry still shows on /evidence because it has a hash.
  expect((await listEvidence(db, {}))[0]).toMatchObject({ status: "failed", txHash: HASH, error: "no_fill" });
  // A new plan on the same pool is allowed once the old one left pending_entry.
  expect(await createPlanWithEntry(db, input())).not.toBeNull();
});

test("listEvidence returns only rows with a tx hash, newest first, filtered by account", async () => {
  const { db, key } = await setup();
  const base = {
    kind: "stop_close" as const,
    status: "confirmed" as const,
    pool: POOL,
    botKeyId: key.id,
    isBid: false,
    qtyRaw: 10n,
    priceBound: 1n,
  };
  const first = await recordExecution(db, { ...base, account: ACCOUNT, txHash: `0x${"01".repeat(32)}` });
  await recordExecution(db, { ...base, account: ACCOUNT });
  const third = await recordExecution(db, { ...base, account: OTHER, txHash: `0x${"03".repeat(32)}` });
  await updateExecution(db, third, { filledRaw: 10n });
  expect((await listEvidence(db, {})).map((e) => e.id)).toEqual([third, first]);
  expect((await listEvidence(db, { account: ACCOUNT })).map((e) => e.id)).toEqual([first]);
  expect(await listEvidence(db, { limit: 1 })).toHaveLength(1);
  expect(await listStopExecutions(db, "00000000-0000-0000-0000-000000000000")).toEqual([]);
});

test("medianStopLatencyMs is the median of confirmed stop closes and null with none", async () => {
  const { db, key } = await setup();
  expect(await medianStopLatencyMs(db)).toBeNull();
  const triggeredAt = new Date("2026-10-28T09:00:00Z");
  const close = async (ms: number, status: "confirmed" | "failed" = "confirmed") => {
    const stop = await insertStop(db, {
      account: ACCOUNT,
      pool: POOL,
      botKeyId: key.id,
      positionSide: "long",
      triggerPrice: 1n,
      triggerOp: "lte",
      qtyMode: "entire",
      status: "done",
      triggeredAt,
    });
    await recordExecution(db, {
      kind: "stop_close",
      status,
      account: ACCOUNT,
      pool: POOL,
      botKeyId: key.id,
      stopId: stop.id,
      isBid: false,
      qtyRaw: 10n,
      priceBound: 1n,
      txHash: HASH,
      updatedAt: new Date(triggeredAt.getTime() + ms),
    });
  };
  await close(2_400);
  await close(1_800);
  await close(3_300);
  await close(60_000, "failed");
  expect(await medianStopLatencyMs(db)).toBe(2_400);
  await close(2_600);
  expect(await medianStopLatencyMs(db)).toBe(2_500);
});
