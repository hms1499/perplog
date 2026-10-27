import type { Address } from "@perplog/core";
import { isNotNull } from "drizzle-orm";
import type { Db } from "../client";
import { sessions, watchedAccounts } from "../schema";

export async function upsertWatch(db: Db, account: Address, source: "session" | "watch"): Promise<void> {
  await db
    .insert(watchedAccounts)
    .values({ account, source })
    .onConflictDoUpdate({ target: watchedAccounts.account, set: { source } });
}

/** watched_accounts ∪ accounts of bound sessions. */
export async function listWatchedAccounts(db: Db): Promise<Address[]> {
  const [watched, bound] = await Promise.all([
    db.select({ account: watchedAccounts.account }).from(watchedAccounts),
    db.selectDistinct({ account: sessions.account }).from(sessions).where(isNotNull(sessions.account)),
  ]);
  const all = new Set<Address>();
  for (const r of watched) all.add(r.account);
  for (const r of bound) if (r.account) all.add(r.account);
  return [...all];
}
