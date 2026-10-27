import { EQUITY_MAX_POINTS } from "./config";
import { computeLeaks } from "./leaks";
import type {
  EnrichedTrade,
  EquityPoint,
  FundingPayment,
  HealthSummary,
  Range,
  ReconcileResult,
} from "./types";

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

/**
 * Running net PnL over closed trades and unattributed funding (paid funding is a loss),
 * one point per second, evenly thinned to `maxPoints` while keeping both ends.
 */
export function equityCurve(
  closed: EnrichedTrade[],
  unattributedFunding: FundingPayment[],
  maxPoints = EQUITY_MAX_POINTS,
): EquityPoint[] {
  const events = [
    ...closed.map((t) => ({ at: t.closedAt as number, delta: t.netPnl })),
    ...unattributedFunding.map((f) => ({ at: f.timestamp, delta: -f.amount })),
  ].sort((a, b) => a.at - b.at);
  const points: EquityPoint[] = [];
  let total = 0n;
  for (const e of events) {
    total += e.delta;
    const last = points.at(-1);
    if (last?.at === e.at) last.netRaw = total;
    else points.push({ at: e.at, netRaw: total });
  }
  if (points.length <= maxPoints) return points;
  const step = (points.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => points[Math.round(i * step)] as EquityPoint);
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
    equity: equityCurve(closed, funding),
  };
}
