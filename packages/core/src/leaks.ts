import { TILT_MULTIPLE_DEN, TILT_MULTIPLE_NUM, TILT_WINDOW_SEC } from "./config";
import type { EnrichedTrade, FundingPayment, Leak, LeakFix, LeakId } from "./types";
import { ratioBps } from "./units";

const positive = (x: bigint) => (x > 0n ? x : 0n);
const loss = (t: EnrichedTrade) => (t.netPnl < 0n ? -t.netPnl : 0n);

function lowerMedian(values: bigint[]): bigint {
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0n;
}

/** Trades opened within the tilt window after a loss, sized well above the account's usual size. */
function tiltTrades(trades: EnrichedTrade[]): EnrichedTrade[] {
  const median = lowerMedian(trades.map((t) => t.maxNotional).filter((n) => n > 0n));
  if (median === 0n) return [];
  const losses = trades.filter((t) => t.closedAt !== null && t.netPnl < 0n);
  return trades.filter((t) => {
    if (t.maxNotional === 0n || t.maxNotional * TILT_MULTIPLE_DEN < median * TILT_MULTIPLE_NUM) return false;
    let lastLossAt: number | null = null;
    for (const l of losses) {
      const closedAt = l.closedAt as number;
      if (l.id !== t.id && closedAt <= t.openedAt && (lastLossAt === null || closedAt > lastLossAt)) {
        lastLossAt = closedAt;
      }
    }
    return lastLossAt !== null && t.openedAt - lastLossAt <= TILT_WINDOW_SEC;
  });
}

/**
 * Deterministic leak rules L1–L4 (spec §6.5). `trades` and `unattributedFunding`
 * must already be filtered to the selected range.
 */
export function computeLeaks(trades: EnrichedTrade[], unattributedFunding: FundingPayment[]): Leak[] {
  const totalLoss = trades.reduce((acc, t) => acc + loss(t), 0n);
  const leak = (
    id: LeakId,
    title: string,
    fix: LeakFix,
    amountRaw: bigint,
    evidence: EnrichedTrade[],
  ): Leak => ({
    id,
    title,
    amountRaw,
    shareOfLossBps: ratioBps(amountRaw, totalLoss),
    evidenceTradeIds: evidence.map((t) => t.id),
    fix,
  });

  const liquidated = trades.filter((t) => t.exitType === "LIQUIDATED");
  const noStop = trades.filter((t) => !t.hadStop && t.netPnl < 0n);
  const paidFunding = trades.filter((t) => t.costs.funding > 0n);
  const tilt = tiltTrades(trades);

  const leaks = [
    leak(
      "LIQUIDATION_COST",
      "Liquidations",
      "PROTECT_NOW",
      liquidated.reduce((acc, t) => acc + t.costs.liquidationFee + positive(-t.realizedPnl), 0n),
      liquidated,
    ),
    leak(
      "NO_STOP_LOSSES",
      "Losses on trades without a stop-loss",
      "ALWAYS_PROTECT",
      noStop.reduce((acc, t) => acc + loss(t), 0n),
      noStop,
    ),
    leak(
      "FUNDING_DRAG",
      "Funding you paid",
      "SHOW_FUNDING",
      paidFunding.reduce((acc, t) => acc + t.costs.funding, 0n) +
        unattributedFunding.reduce((acc, f) => acc + positive(f.amount), 0n),
      paidFunding,
    ),
    leak(
      "SIZE_UP_AFTER_LOSS",
      "Sizing up right after a loss",
      "FIXED_RISK",
      tilt.reduce((acc, t) => acc + loss(t), 0n),
      tilt,
    ),
  ];
  return leaks
    .filter((l) => l.amountRaw > 0n)
    .sort((a, b) => (a.amountRaw > b.amountRaw ? -1 : a.amountRaw < b.amountRaw ? 1 : 0));
}
