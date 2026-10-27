import { isAutomatedCohort } from "./cohort";
import { isStopLossFor } from "./coverage";
import type { Address, PositionChange, StopOrderRecord } from "./types";

const STOP_WINDOW_BEFORE_SEC = 60;
const STOP_WINDOW_AFTER_SEC = 600;

export interface NoStopStats {
  newPositions: number;
  accounts: number;
  withStopPct: number;
  noStopPct: number;
}

const pct = (n: number, total: number) => (total === 0 ? 0 : Math.round((100 * n) / total));

/**
 * Share of new positions that got a stop-loss within −60s..+600s of opening,
 * excluding the automated cohort (spec §1, E1). Positions opened less than
 * 600s before `nowSec` are left out, since their window has not closed yet.
 */
export function computeNoStopStats(
  changes: PositionChange[],
  stops: StopOrderRecord[],
  accountOf: (c: PositionChange) => Address,
  ownerOf: (s: StopOrderRecord) => Address,
  nowSec = Number.POSITIVE_INFINITY,
): NoStopStats {
  const perAccount = new Map<Address, { count: number; pnl: bigint }>();
  for (const c of changes) {
    const a = accountOf(c);
    const agg = perAccount.get(a) ?? { count: 0, pnl: 0n };
    agg.count += 1;
    agg.pnl += c.realizedPnl;
    perAccount.set(a, agg);
  }
  const real = (a: Address) => {
    const agg = perAccount.get(a);
    return agg !== undefined && !isAutomatedCohort(agg.count, agg.pnl);
  };
  const stopsByKey = new Map<string, StopOrderRecord[]>();
  for (const s of stops) {
    const key = `${ownerOf(s)}:${s.pool}`;
    const list = stopsByKey.get(key);
    if (list) list.push(s);
    else stopsByKey.set(key, [s]);
  }
  const opens = changes.filter(
    (c) => c.kind === "OPEN" && c.timestamp <= nowSec - STOP_WINDOW_AFTER_SEC && real(accountOf(c)),
  );
  const withStop = opens.filter((c) => {
    const side = c.sizeAfter < 0n ? "short" : "long";
    return (stopsByKey.get(`${accountOf(c)}:${c.pool}`) ?? []).some(
      (s) =>
        isStopLossFor(side, s) &&
        s.createdAt >= c.timestamp - STOP_WINDOW_BEFORE_SEC &&
        s.createdAt <= c.timestamp + STOP_WINDOW_AFTER_SEC,
    );
  }).length;
  return {
    newPositions: opens.length,
    accounts: new Set(opens.map(accountOf)).size,
    withStopPct: pct(withStop, opens.length),
    noStopPct: pct(opens.length - withStop, opens.length),
  };
}
