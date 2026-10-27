import { sql } from "drizzle-orm";
import type { Db } from "../client";
import { rateLimits } from "../schema";

/** Counts a hit in the current one-minute window. True = allowed (count within the limit). */
export async function hitRateLimit(db: Db, key: string, limitPerMinute: number, now: Date): Promise<boolean> {
  const windowStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });
  return (row?.count ?? 1) <= limitPerMinute;
}
