import type { Address } from "@perplog/core";
import type { AlertRow, AlertType } from "@perplog/db";

export interface AlertView {
  id: string;
  type: AlertType;
  pool: Address | null;
  /** The pool's market symbol, when the market list could be read. */
  symbol: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export function toAlertView(row: AlertRow, symbols: Map<string, string>): AlertView {
  return {
    id: row.id,
    type: row.type,
    pool: row.pool,
    symbol: row.pool ? (symbols.get(row.pool) ?? null) : null,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  };
}
