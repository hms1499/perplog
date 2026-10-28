import type { Address, Side } from "@perplog/core";
import type { PlanRow, PlanStatus } from "@perplog/db";

export interface PlanView {
  id: string;
  pool: Address;
  side: Side;
  qtyRaw: bigint;
  stopPrice: bigint;
  status: PlanStatus;
  stopId: string | null;
  txHash: string | null;
}

export function toPlanView(row: PlanRow, txHash: string | null): PlanView {
  return {
    id: row.id,
    pool: row.pool,
    side: row.side,
    qtyRaw: row.qtyRaw,
    stopPrice: row.stopPrice,
    status: row.status,
    stopId: row.stopId,
    txHash,
  };
}
