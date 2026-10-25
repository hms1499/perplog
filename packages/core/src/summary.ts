import { computeLeaks } from "./leaks";
import type { EnrichedTrade, FundingPayment, HealthSummary, Range, ReconcileResult } from "./types";

const DAY = 86_400;

export function rangeStart(range: Range, nowSec: number): number {
  if (range === "7d") return nowSec - 7 * DAY;
  if (range === "30d") return nowSec - 30 * DAY;
  return 0;
}

/** Closed trades whose close falls inside the range (spec §6.3). */
export function filterRange(trades: EnrichedTrade[], range: Range, nowSec: number): EnrichedTrade[] {
  const start = rangeStart(range, nowSec);
  return trades.filter((t) => t.closedAt !== null && t.closedAt >= start);
}

export function filterFundingRange(rows: FundingPayment[], range: Range, nowSec: number): FundingPayment[] {
  const start = rangeStart(range, nowSec);
  return rows.filter((r) => r.timestamp >= start);
}

const pct = (count: number, total: number) => (total === 0 ? 0 : Math.round((100 * count) / total));

export function buildHealthSummary(args: {
  trades: EnrichedTrade[];
  unattributedFunding: FundingPayment[];
  range: Range;
  nowSec: number;
  reconcile: ReconcileResult | null;
}): HealthSummary {
  const closed = filterRange(args.trades, args.range, args.nowSec);
  const funding = filterFundingRange(args.unattributedFunding, args.range, args.nowSec);
  const unattributed = funding.reduce((acc, f) => acc + f.amount, 0n);
  const leaks = computeLeaks(closed, funding);
  return {
    range: args.range,
    tradeCount: closed.length,
    openTradeCount: args.trades.filter((t) => t.closedAt === null).length,
    netPnlRaw: closed.reduce((acc, t) => acc + t.netPnl, 0n) - unattributed,
    realizedPnlRaw: closed.reduce((acc, t) => acc + t.realizedPnl, 0n),
    fundingPaidRaw: closed.reduce((acc, t) => acc + t.costs.funding, 0n) + unattributed,
    liquidationCostRaw: leaks.find((l) => l.id === "LIQUIDATION_COST")?.amountRaw ?? 0n,
    tradesWithoutStopPct: pct(closed.filter((t) => !t.hadStop).length, closed.length),
    winRatePct: pct(closed.filter((t) => t.netPnl > 0n).length, closed.length),
    topLeak: leaks[0] ?? null,
    reconcile: args.reconcile,
  };
}
