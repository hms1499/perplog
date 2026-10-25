import type { Address, Side, StopOrderRecord, Trade } from "./types";
import { absBig } from "./units";

/** A stop-loss closes the position when price moves against it: sell-at-or-below for longs, buy-at-or-above for shorts. */
export function isStopLossFor(side: Side, s: StopOrderRecord): boolean {
  return side === "long" ? !s.isBid && s.triggerOperator === 1 : s.isBid && s.triggerOperator === 0;
}

export function tradeHadStop(trade: Trade, stopOrders: StopOrderRecord[], nowSec: number): boolean {
  const end = trade.closedAt ?? nowSec;
  return stopOrders.some(
    (s) =>
      s.pool === trade.pool &&
      isStopLossFor(trade.side, s) &&
      s.createdAt <= end &&
      (s.status === "PENDING" || s.updatedAt >= trade.openedAt),
  );
}

/** Share of an open position covered by pending stop-losses, in bps (quantity 0 = whole position). */
export function stopCoverageBps(
  side: Side,
  sizeRaw: bigint,
  pool: Address,
  stopOrders: StopOrderRecord[],
): number {
  const size = absBig(sizeRaw);
  if (size === 0n) return 0;
  let covered = 0n;
  for (const s of stopOrders) {
    if (s.pool !== pool || s.status !== "PENDING" || !isStopLossFor(side, s)) continue;
    if (s.quantity === 0n) return 10_000;
    covered += s.quantity;
  }
  return covered >= size ? 10_000 : Number((covered * 10_000n) / size);
}
