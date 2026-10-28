import type { Address, Side } from "@perplog/core";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "../client";
import { alerts, type ExecutionRow, executions, type PlanRow, plans, stops } from "../schema";

export interface NewPlanInput {
  account: Address;
  pool: Address;
  botKeyId: string;
  side: Side;
  riskRaw: bigint;
  refPrice: bigint;
  stopPrice: bigint;
  qtyRaw: bigint;
  priceBound: bigint;
  leverageEstBps: bigint | null;
  liqPriceEst: bigint | null;
}

export interface EntryFill {
  txHash: string;
  orderId: bigint | null;
  filledRaw: bigint;
  avgPrice: bigint | null;
  gasUsed: bigint;
}

const isUniqueViolation = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
};

/** One transaction: the plan (pending_entry) and its queued entry execution. A unique violation → null. */
export async function createPlanWithEntry(
  db: Db,
  p: NewPlanInput,
): Promise<{ plan: PlanRow; executionId: string } | null> {
  try {
    return await db.transaction(async (tx) => {
      const { botKeyId, ...fields } = p;
      const [plan] = await tx
        .insert(plans)
        .values({ ...fields, status: "pending_entry" })
        .returning();
      const planId = (plan as PlanRow).id;
      const [entry] = await tx
        .insert(executions)
        .values({
          kind: "entry",
          status: "queued",
          account: p.account,
          pool: p.pool,
          botKeyId,
          planId,
          isBid: p.side === "long",
          qtyRaw: p.qtyRaw,
          priceBound: p.priceBound,
        })
        .returning({ id: executions.id });
      const executionId = (entry as { id: string }).id;
      const [linked] = await tx
        .update(plans)
        .set({ entryExecutionId: executionId })
        .where(eq(plans.id, planId))
        .returning();
      return { plan: linked as PlanRow, executionId };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

export async function getPlan(db: Db, id: string): Promise<PlanRow | null> {
  const [row] = await db.select().from(plans).where(eq(plans.id, id)).limit(1);
  return row ?? null;
}

/** CAS queued → sending, oldest first, at most `limit`. Returns the claimed rows. */
export async function claimQueuedEntries(db: Db, limit: number): Promise<ExecutionRow[]> {
  const queued = db
    .select({ id: executions.id })
    .from(executions)
    .where(and(eq(executions.kind, "entry"), eq(executions.status, "queued")))
    .orderBy(asc(executions.createdAt))
    .limit(limit)
    .for("update", { skipLocked: true });
  const rows = await db
    .update(executions)
    .set({ status: "sending", updatedAt: new Date() })
    .where(and(inArray(executions.id, queued), eq(executions.status, "queued")))
    .returning();
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** CAS sending → queued for an entry that was claimed but not sent (the bot had a pending tx). */
export async function requeueEntry(db: Db, executionId: string): Promise<boolean> {
  const rows = await db
    .update(executions)
    .set({ status: "queued", updatedAt: new Date() })
    .where(
      and(eq(executions.id, executionId), eq(executions.kind, "entry"), eq(executions.status, "sending")),
    )
    .returning({ id: executions.id });
  return rows.length > 0;
}

/** Entries left sending/sent (crash or unknown outcome), for the resolver. */
export async function listOpenEntries(db: Db): Promise<ExecutionRow[]> {
  return db
    .select()
    .from(executions)
    .where(and(eq(executions.kind, "entry"), inArray(executions.status, ["sending", "sent"])))
    .orderBy(asc(executions.createdAt));
}

/**
 * One transaction: the execution confirmed, a stop inserted (armed, entire, source plan), and the plan
 * pending_entry → entered or partially_entered. False when the plan already left pending_entry.
 */
export async function settleEntryFilled(
  db: Db,
  a: { executionId: string; fill: EntryFill },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [entry] = await tx.select().from(executions).where(eq(executions.id, a.executionId)).limit(1);
    if (!entry?.planId || entry.kind !== "entry") return false;
    const [plan] = await tx.select().from(plans).where(eq(plans.id, entry.planId)).limit(1);
    if (!plan) return false;
    const status = a.fill.filledRaw >= plan.qtyRaw ? "entered" : "partially_entered";
    const moved = await tx
      .update(plans)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(plans.id, plan.id), eq(plans.status, "pending_entry")))
      .returning({ id: plans.id });
    if (moved.length === 0) return false;

    await tx
      .update(executions)
      .set({ status: "confirmed", error: null, ...a.fill, updatedAt: new Date() })
      .where(eq(executions.id, entry.id));
    // As insertStop does: a new stop replaces any armed/paused one on the same (account, pool).
    await tx
      .update(stops)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(
        and(
          eq(stops.account, plan.account),
          eq(stops.pool, plan.pool),
          inArray(stops.status, ["armed", "paused"]),
        ),
      );
    const [stop] = await tx
      .insert(stops)
      .values({
        account: plan.account,
        pool: plan.pool,
        botKeyId: entry.botKeyId,
        positionSide: plan.side,
        triggerPrice: plan.stopPrice,
        triggerOp: plan.side === "long" ? "lte" : "gte",
        qtyMode: "entire",
        source: "plan",
        status: "armed",
      })
      .returning({ id: stops.id });
    await tx
      .update(plans)
      .set({ stopId: (stop as { id: string }).id })
      .where(eq(plans.id, plan.id));
    return true;
  });
}

/**
 * One transaction: the execution failed (error, optional txHash), the plan → entry_failed, and an entry_failed
 * alert with payload { planId, pool, reason }.
 */
export async function settleEntryFailed(
  db: Db,
  a: { executionId: string; error: string; txHash?: string | null },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [entry] = await tx.select().from(executions).where(eq(executions.id, a.executionId)).limit(1);
    if (!entry?.planId || entry.kind !== "entry") return false;
    const moved = await tx
      .update(plans)
      .set({ status: "entry_failed", updatedAt: new Date() })
      .where(and(eq(plans.id, entry.planId), eq(plans.status, "pending_entry")))
      .returning({ id: plans.id });
    if (moved.length === 0) return false;
    await tx
      .update(executions)
      .set({
        status: "failed",
        error: a.error,
        ...(a.txHash ? { txHash: a.txHash } : {}),
        updatedAt: new Date(),
      })
      .where(eq(executions.id, entry.id));
    await tx.insert(alerts).values({
      account: entry.account,
      type: "entry_failed",
      pool: entry.pool,
      payload: { planId: entry.planId, pool: entry.pool, reason: a.error },
    });
    return true;
  });
}

/** The latest executions with a tx hash, newest first, optionally for one account. */
export async function listEvidence(
  db: Db,
  opts: { account?: Address; limit?: number },
): Promise<ExecutionRow[]> {
  return db
    .select()
    .from(executions)
    .where(and(isNotNull(executions.txHash), opts.account ? eq(executions.account, opts.account) : undefined))
    .orderBy(desc(executions.createdAt))
    .limit(opts.limit ?? 200);
}

export async function getExecution(db: Db, id: string): Promise<ExecutionRow | null> {
  const [row] = await db.select().from(executions).where(eq(executions.id, id)).limit(1);
  return row ?? null;
}

/** Median of `confirmed_at − triggered_at` (ms) over confirmed stop closes; null when there are none. */
export async function medianStopLatencyMs(db: Db): Promise<number | null> {
  const rows = await db
    .select({ confirmedAt: executions.updatedAt, triggeredAt: stops.triggeredAt })
    .from(executions)
    .innerJoin(stops, eq(executions.stopId, stops.id))
    .where(
      and(
        eq(executions.kind, "stop_close"),
        eq(executions.status, "confirmed"),
        isNotNull(stops.triggeredAt),
      ),
    );
  const ms = rows
    .map((r) => r.confirmedAt.getTime() - (r.triggeredAt as Date).getTime())
    .sort((a, b) => a - b);
  if (ms.length === 0) return null;
  const mid = Math.floor(ms.length / 2);
  return ms.length % 2 === 1 ? (ms[mid] as number) : ((ms[mid - 1] as number) + (ms[mid] as number)) / 2;
}
