import type { Address } from "@perplog/core";
import { asc, eq } from "drizzle-orm";
import type { Db } from "../client";
import { type BotKeyRow, botKeys, type SessionRow, sessions } from "../schema";

export async function createBotKeyRequest(db: Db): Promise<BotKeyRow> {
  const [row] = await db.insert(botKeys).values({}).returning();
  return row as BotKeyRow;
}

/**
 * Worker-side: fills every `requested` key (up to `limit`) exactly once.
 * Rows are locked with FOR UPDATE SKIP LOCKED inside one transaction so concurrent workers never double-fill.
 */
export async function claimRequestedBotKeys(
  db: Db,
  limit: number,
  fill: (id: string) => { address: Address; encPk: string; iv: string; tag: string },
): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: botKeys.id })
      .from(botKeys)
      .where(eq(botKeys.status, "requested"))
      .orderBy(asc(botKeys.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    for (const { id } of rows) {
      const { address, encPk, iv, tag } = fill(id);
      await tx
        .update(botKeys)
        .set({ address, encPk, encIv: iv, encTag: tag, status: "pending" })
        .where(eq(botKeys.id, id));
    }
    return rows.length;
  });
}

export async function bindBotKey(
  db: Db,
  botKeyId: string,
  account: Address,
  pools: Address[],
): Promise<void> {
  await db
    .update(botKeys)
    .set({ account, linkedPools: pools, status: "linked", linkedAt: new Date(), checkedAt: new Date() })
    .where(eq(botKeys.id, botKeyId));
}

export async function setLinkedPools(
  db: Db,
  botKeyId: string,
  pools: Address[],
  status: "linked" | "revoked",
): Promise<void> {
  await db
    .update(botKeys)
    .set({ linkedPools: pools, status, checkedAt: new Date() })
    .where(eq(botKeys.id, botKeyId));
}

export async function listLinkedBotKeys(db: Db): Promise<BotKeyRow[]> {
  return db.select().from(botKeys).where(eq(botKeys.status, "linked"));
}

export async function getBotKey(db: Db, id: string): Promise<BotKeyRow | null> {
  const [row] = await db.select().from(botKeys).where(eq(botKeys.id, id));
  return row ?? null;
}

export async function createSession(db: Db, botKeyId: string): Promise<SessionRow> {
  const [row] = await db.insert(sessions).values({ botKeyId }).returning();
  return row as SessionRow;
}

export async function getSession(
  db: Db,
  id: string,
): Promise<(SessionRow & { botKey: BotKeyRow | null }) | null> {
  const [row] = await db
    .select({ session: sessions, botKey: botKeys })
    .from(sessions)
    .leftJoin(botKeys, eq(sessions.botKeyId, botKeys.id))
    .where(eq(sessions.id, id));
  return row ? { ...row.session, botKey: row.botKey } : null;
}

export async function bindSession(db: Db, sessionId: string, account: Address): Promise<void> {
  await db.update(sessions).set({ account, lastSeenAt: new Date() }).where(eq(sessions.id, sessionId));
}
