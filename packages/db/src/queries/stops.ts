import type { Address, StopStatus } from "@perplog/core";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../client";
import {
  type ExecutionRow,
  executions,
  type NewExecution,
  type NewStop,
  type StopRow,
  stops,
} from "../schema";

const TERMINAL: readonly StopStatus[] = ["done", "failed", "cancelled"];

/** Inserts a stop; any other armed/paused stop on the same (account, pool) is cancelled in the same transaction. */
export async function insertStop(db: Db, s: NewStop): Promise<StopRow> {
  return db.transaction(async (tx) => {
    await tx
      .update(stops)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(
        and(eq(stops.account, s.account), eq(stops.pool, s.pool), inArray(stops.status, ["armed", "paused"])),
      );
    const [row] = await tx.insert(stops).values(s).returning();
    return row as StopRow;
  });
}

/** Compare-and-set: `UPDATE … WHERE id AND status IN from`. False when the stop was not in an expected status. */
export async function transitionStop(
  db: Db,
  id: string,
  from: StopStatus[],
  to: StopStatus,
  patch: Partial<StopRow> = {},
): Promise<boolean> {
  const { id: _id, status: _status, ...rest } = patch;
  const rows = await db
    .update(stops)
    .set({
      ...rest,
      status: to,
      ...(TERMINAL.includes(to) ? { finishedAt: rest.finishedAt ?? new Date() } : {}),
    })
    .where(and(eq(stops.id, id), inArray(stops.status, from)))
    .returning({ id: stops.id });
  return rows.length > 0;
}

export async function listStops(db: Db, statuses: StopStatus[]): Promise<StopRow[]> {
  if (statuses.length === 0) return [];
  return db.select().from(stops).where(inArray(stops.status, statuses));
}

export async function getStop(db: Db, id: string): Promise<StopRow | undefined> {
  const [row] = await db.select().from(stops).where(eq(stops.id, id)).limit(1);
  return row;
}

export async function listAccountStops(db: Db, account: Address, statuses: StopStatus[]): Promise<StopRow[]> {
  if (statuses.length === 0) return [];
  return db
    .select()
    .from(stops)
    .where(and(eq(stops.account, account), inArray(stops.status, statuses)));
}

export async function recordExecution(db: Db, e: NewExecution): Promise<string> {
  const [row] = await db.insert(executions).values(e).returning({ id: executions.id });
  return (row as { id: string }).id;
}

export async function updateExecution(db: Db, id: string, patch: Partial<NewExecution>): Promise<void> {
  const { id: _id, ...rest } = patch;
  await db
    .update(executions)
    .set({ ...rest, updatedAt: new Date() })
    .where(eq(executions.id, id));
}

/** Every execution recorded for one stop, oldest first. */
export async function listStopExecutions(db: Db, stopId: string): Promise<ExecutionRow[]> {
  return db.select().from(executions).where(eq(executions.stopId, stopId)).orderBy(asc(executions.createdAt));
}

/** Tx hashes of the bot's stop-close orders for this account, so the UI can tell them from user trades. */
export async function stopCloseTxHashes(db: Db, account: Address): Promise<Set<string>> {
  const rows = await db
    .select({ txHash: executions.txHash })
    .from(executions)
    .where(and(eq(executions.account, account), eq(executions.kind, "stop_close")));
  return new Set(rows.flatMap((r) => (r.txHash ? [r.txHash] : [])));
}
