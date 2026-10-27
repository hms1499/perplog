import type { Address } from "@perplog/core";
import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import type { Db } from "../client";
import { type AlertRow, type AlertType, alerts } from "../schema";

/** Returns false (and inserts nothing) when the same (account, type, pool) alert exists within `dedupeWithinSec`. */
export async function insertAlert(
  db: Db,
  a: { account: Address; type: AlertType; pool?: Address; payload: object; dedupeWithinSec?: number },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (a.dedupeWithinSec !== undefined) {
      const since = new Date(Date.now() - a.dedupeWithinSec * 1000);
      const [dup] = await tx
        .select({ id: alerts.id })
        .from(alerts)
        .where(
          and(
            eq(alerts.account, a.account),
            eq(alerts.type, a.type),
            a.pool ? eq(alerts.pool, a.pool) : isNull(alerts.pool),
            gte(alerts.createdAt, since),
          ),
        )
        .limit(1);
      if (dup) return false;
    }
    await tx.insert(alerts).values({
      account: a.account,
      type: a.type,
      pool: a.pool ?? null,
      payload: a.payload as Record<string, unknown>,
    });
    return true;
  });
}

export async function listAlerts(db: Db, account: Address, sinceMs: number, limit = 50): Promise<AlertRow[]> {
  return db
    .select()
    .from(alerts)
    .where(and(eq(alerts.account, account), gte(alerts.createdAt, new Date(sinceMs))))
    .orderBy(desc(alerts.createdAt), sql`${alerts.id}`)
    .limit(limit);
}

/** Oldest first from `sinceMs` (inclusive): a poller passes the last `createdAt` it saw and dedupes by id. */
export async function listAlertsSince(
  db: Db,
  account: Address,
  sinceMs: number,
  limit = 50,
): Promise<AlertRow[]> {
  return db
    .select()
    .from(alerts)
    .where(and(eq(alerts.account, account), gte(alerts.createdAt, new Date(sinceMs))))
    .orderBy(asc(alerts.createdAt), sql`${alerts.id}`)
    .limit(limit);
}
