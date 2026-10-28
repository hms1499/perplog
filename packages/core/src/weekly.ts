import { computeLeaks } from "./leaks";
import type { EnrichedTrade, FundingPayment, Leak } from "./types";

const DAY = 86_400;
const WEEK = 7 * DAY;

export interface WeeklyReport {
  weekStart: string;
  tradeCount: number;
  netPnlRaw: bigint;
  realizedPnlRaw: bigint;
  winRatePct: number;
  fundingPaidRaw: bigint;
  liquidationCostRaw: bigint;
  tradesWithoutStopPct: number;
  topLeak: Leak | null;
  /** Trades closed by a PerpLog bot-held stop this week. */
  perplogStops: number;
}

/** Monday 00:00 UTC of the week holding `nowSec`, as "YYYY-MM-DD". */
export function isoWeekStart(nowSec: number): string {
  const day = Math.floor(nowSec / DAY);
  // 1970-01-01 was a Thursday: (day + 3) % 7 is the number of days since Monday.
  const monday = (day - ((day + 3) % 7)) * DAY;
  return new Date(monday * 1000).toISOString().slice(0, 10);
}

/** Unix seconds of a "YYYY-MM-DD" Monday; null for anything else. */
export function weekStartSec(week: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return null;
  const ms = Date.parse(`${week}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== week) return null;
  const sec = ms / 1000;
  return isoWeekStart(sec) === week ? sec : null;
}

const pct = (count: number, total: number) => (total === 0 ? 0 : Math.round((100 * count) / total));

/** Trades with closedAt in [weekStart, weekStart + 7d); the same accounting as the Health summary. */
export function buildWeeklyReport(a: {
  trades: EnrichedTrade[];
  unattributedFunding: FundingPayment[];
  weekStart: string;
}): WeeklyReport {
  const start = weekStartSec(a.weekStart);
  if (start === null) throw new Error(`not a week start: ${a.weekStart}`);
  const end = start + WEEK;
  const closed = a.trades.filter((t) => t.closedAt !== null && t.closedAt >= start && t.closedAt < end);
  const funding = a.unattributedFunding.filter((f) => f.timestamp >= start && f.timestamp < end);
  const unattributed = funding.reduce((acc, f) => acc + f.amount, 0n);
  const leaks = computeLeaks(closed, funding);
  return {
    weekStart: a.weekStart,
    tradeCount: closed.length,
    netPnlRaw: closed.reduce((acc, t) => acc + t.netPnl, 0n) - unattributed,
    realizedPnlRaw: closed.reduce((acc, t) => acc + t.realizedPnl, 0n),
    winRatePct: pct(closed.filter((t) => t.netPnl > 0n).length, closed.length),
    fundingPaidRaw: closed.reduce((acc, t) => acc + t.costs.funding, 0n) + unattributed,
    liquidationCostRaw: leaks.find((l) => l.id === "LIQUIDATION_COST")?.amountRaw ?? 0n,
    tradesWithoutStopPct: pct(closed.filter((t) => !t.hadStop).length, closed.length),
    topLeak: leaks[0] ?? null,
    perplogStops: closed.filter((t) => t.exitType === "PERPLOG_STOP").length,
  };
}
