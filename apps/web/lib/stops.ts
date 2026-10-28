import { type Address, normalizeAddress } from "@perplog/core";
import type { StopRow } from "@perplog/db";
import type { StopView } from "./account-service";

export const POOL_NOT_LINKED_MESSAGE =
  "PerpLog's bot is not linked for this market. In the dreamDEX app, open your wallet → Link a bot → tick Perps and paste the same bot address again.";

export function toStopView(row: StopRow): StopView {
  return {
    id: row.id,
    pool: row.pool,
    positionSide: row.positionSide,
    triggerPrice: row.triggerPrice,
    qtyMode: row.qtyMode,
    qtyRaw: row.qtyRaw,
    status: row.status,
  };
}

export interface LinkedSession {
  account: Address;
  botKeyId: string;
  botAddress: Address;
}

/** The account and bot behind a session, or null while the session has no linked bot key. */
export function linkedOf(session: {
  account: Address | null;
  botKey: { id: string; status: string; address: Address | null } | null;
}): LinkedSession | null {
  const { botKey } = session;
  const account = session.account ? normalizeAddress(session.account) : null;
  if (!account || botKey?.status !== "linked" || !botKey.address) return null;
  return { account, botKeyId: botKey.id, botAddress: botKey.address };
}
