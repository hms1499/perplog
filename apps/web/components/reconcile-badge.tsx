import { formatUsd, type ReconcileResult } from "@perplog/core";
import type { Wire } from "@/lib/api";

export function ReconcileBadge({
  reconcile,
  truncated,
  chainReadFailed,
}: {
  reconcile: Wire<ReconcileResult> | null;
  truncated: boolean;
  chainReadFailed: boolean;
}) {
  if (truncated) {
    return <span className="text-muted text-sm">Not reconciled: history truncated</span>;
  }
  if (chainReadFailed || !reconcile) {
    return <span className="text-muted text-sm">Not reconciled: chain read failed</span>;
  }
  if (reconcile.ok) {
    return (
      <span
        className="inline-block rounded-md border border-gain/40 bg-gain/10 px-2 py-0.5 font-semibold text-gain text-sm"
        title="The sum of every indexed event equals your collateral on-chain right now."
      >
        ✓ Reconciled with chain
      </span>
    );
  }
  return (
    <span className="font-semibold text-loss text-sm">
      ⚠ Unreconciled (delta {formatUsd(BigInt(reconcile.deltaRaw))})
    </span>
  );
}
