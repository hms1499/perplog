import type { Address, Side, StopOrderRecord, Trade } from "./types";
import { absBig, prefixMax, upperBound } from "./units";

/** A stop-loss closes the position when price moves against it: sell-at-or-below for longs, buy-at-or-above for shorts. */
export function isStopLossFor(side: Side, s: StopOrderRecord): boolean {
  return side === "long" ? !s.isBid && s.triggerOperator === 1 : s.isBid && s.triggerOperator === 0;
}

interface StopLifetimes {
  /** Ascending. */
  createdAt: number[];
  /** Running max of when each stop stopped protecting (+Infinity while pending). */
  reach: number[];
}

/**
 * Answers "did this trade have a stop-loss while it was open?" in O(log n) per trade:
 * a stop counts when its lifetime [createdAt, updatedAt or now] overlaps [openedAt, closedAt or now].
 */
export function createStopIndex(stopOrders: StopOrderRecord[]): (trade: Trade, nowSec: number) => boolean {
  const grouped = new Map<string, StopOrderRecord[]>();
  for (const s of stopOrders) {
    for (const side of ["long", "short"] as const) {
      if (!isStopLossFor(side, s)) continue;
      const key = `${s.pool}|${side}`;
      const list = grouped.get(key);
      if (list) list.push(s);
      else grouped.set(key, [s]);
    }
  }
  const index = new Map<string, StopLifetimes>();
  for (const [key, list] of grouped) {
    const sorted = [...list].sort((a, b) => a.createdAt - b.createdAt);
    index.set(key, {
      createdAt: sorted.map((s) => s.createdAt),
      reach: prefixMax(sorted.map((s) => (s.status === "PENDING" ? Number.POSITIVE_INFINITY : s.updatedAt))),
    });
  }
  return (trade, nowSec) => {
    const stops = index.get(`${trade.pool}|${trade.side}`);
    if (!stops) return false;
    const createdBeforeEnd = upperBound(stops.createdAt, trade.closedAt ?? nowSec);
    return createdBeforeEnd > 0 && (stops.reach[createdBeforeEnd - 1] as number) >= trade.openedAt;
  };
}

export function tradeHadStop(trade: Trade, stopOrders: StopOrderRecord[], nowSec: number): boolean {
  return createStopIndex(stopOrders)(trade, nowSec);
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
