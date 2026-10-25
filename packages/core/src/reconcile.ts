import { RECONCILE_TOLERANCE_RAW } from "./config";
import type { AccountHistory, ReconcileResult } from "./types";
import { absBig } from "./units";

const sum = <T>(rows: T[], pick: (row: T) => bigint): bigint =>
  rows.reduce((acc, row) => acc + pick(row), 0n);

/** Collateral implied by every indexed event (spec §6.3, verified on 8/8 accounts). */
export function expectedCollateral(h: AccountHistory): bigint {
  let margin = 0n;
  for (const e of h.marginEvents) {
    if (e.kind === "Credited" || e.kind === "Deposit") margin += e.amount;
    else if (e.kind === "Withdraw") margin -= e.amount;
  }
  return (
    margin +
    sum(h.marginPulls, (p) => p.amount) +
    sum(h.changes, (c) => c.realizedPnl) -
    sum(h.funding, (f) => f.amount) -
    sum(h.fees, (f) => f.amount)
  );
}

export function reconcile(h: AccountHistory, actualRaw: bigint): ReconcileResult {
  const expectedRaw = expectedCollateral(h);
  const deltaRaw = actualRaw - expectedRaw;
  return { expectedRaw, actualRaw, deltaRaw, ok: absBig(deltaRaw) <= RECONCILE_TOLERANCE_RAW };
}
