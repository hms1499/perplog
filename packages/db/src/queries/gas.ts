import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { Db } from "../client";
import { gasTopups } from "../schema";

/** Total wei topped up to this bot key during the UTC day containing `now`. */
export async function gasSentTodayWei(db: Db, botKeyId: string, now: Date): Promise<bigint> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${gasTopups.amountWei}), 0)::text` })
    .from(gasTopups)
    .where(
      and(
        eq(gasTopups.botKeyId, botKeyId),
        gte(gasTopups.createdAt, dayStart),
        lt(gasTopups.createdAt, dayEnd),
      ),
    );
  return BigInt(row?.total ?? "0");
}

export async function recordTopUp(
  db: Db,
  botKeyId: string,
  amountWei: bigint,
  txHash: string,
): Promise<void> {
  await db.insert(gasTopups).values({ botKeyId, amountWei, txHash });
}
