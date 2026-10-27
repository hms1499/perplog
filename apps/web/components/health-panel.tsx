"use client";

import { formatUsd, type Range } from "@perplog/core";
import type { HealthResponse } from "@/lib/account-service";
import type { Wire } from "@/lib/api";
import { formatTime, pct, signClass } from "@/lib/format";
import { useAccountQuery } from "@/lib/use-account";
import { EmptyState } from "./empty-state";
import { EquityChart } from "./equity-chart";
import { ErrorState } from "./error-state";
import { ReconcileBadge } from "./reconcile-badge";

function StatementRow({ label, raw, strong = false }: { label: string; raw: bigint; strong?: boolean }) {
  return (
    <div
      className={`flex items-baseline justify-between gap-6 py-1.5 ${strong ? "text-2xl font-extrabold sm:text-3xl" : "text-lg"}`}
    >
      <span className={strong ? "" : "text-muted"}>{label}</span>
      <span className={`${signClass(raw)}`}>
        {raw > 0n ? "+" : ""}
        {formatUsd(raw)}
      </span>
    </div>
  );
}

export function HealthPanel({ address, range }: { address: string; range: Range }) {
  const { data, error, isPending, refetch } = useAccountQuery<Wire<HealthResponse>>(address, "health", {
    range,
  });
  if (isPending) return <p className="py-10 text-muted">Reading the chain…</p>;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (data.empty) return <EmptyState />;

  const realized = BigInt(data.realizedPnlRaw);
  const funding = BigInt(data.fundingPaidRaw);
  const net = BigInt(data.netPnlRaw);
  const fees = realized - funding - net;

  return (
    <section
      aria-labelledby="statement-title"
      className="grid gap-10 py-8 lg:grid-cols-[minmax(0,1fr)_18rem]"
    >
      <div>
        <h2 id="statement-title" className="mb-4 font-semibold text-muted">
          Your PnL statement, {data.tradeCount} closed {data.tradeCount === 1 ? "trade" : "trades"}
        </h2>
        <div className="max-w-xl rounded-md border border-rule bg-sheet px-5 py-4">
          <StatementRow label="Realized PnL" raw={realized} />
          <StatementRow label="Funding" raw={-funding} />
          <StatementRow label="Liquidation and trading fees" raw={-fees} />
          <div className="my-2 border-ink border-t-2" />
          <div className="-mx-2 rounded-sm bg-marker/35 px-2">
            <StatementRow label="Net PnL" raw={net} strong />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <ReconcileBadge
            reconcile={data.reconcile}
            truncated={data.truncated}
            chainReadFailed={data.chainReadFailed}
          />
          <span className="text-muted text-sm">Data as of {formatTime(data.asOfTimestamp)}</span>
        </div>
      </div>

      <dl className="grid content-start gap-5">
        <div>
          <dt
            className="text-muted text-sm"
            title="Liquidation fees plus the realized losses of liquidated trades"
          >
            Lost to liquidations
          </dt>
          <dd className={`text-2xl font-bold ${BigInt(data.liquidationCostRaw) > 0n ? "text-loss" : ""}`}>
            {formatUsd(BigInt(data.liquidationCostRaw))}
          </dd>
        </div>
        <div>
          <dt className="text-muted text-sm">Trades without stop-loss</dt>
          <dd className="text-2xl font-bold">{pct(data.tradesWithoutStopPct)}</dd>
        </div>
        <div>
          <dt className="text-muted text-sm">Win rate</dt>
          <dd className="text-2xl font-bold">{pct(data.winRatePct)}</dd>
        </div>
        {data.openTradeCount > 0 && (
          <div>
            <dt className="text-muted text-sm">Open positions</dt>
            <dd className="text-2xl font-bold">{data.openTradeCount}</dd>
          </div>
        )}
      </dl>

      <EquityChart points={data.equity} />

      {data.topLeak && (
        <p data-testid="top-leak" className="border-loss border-l-4 pl-4 text-lg lg:col-span-2">
          Your biggest leak is <strong>{data.topLeak.title}</strong>:{" "}
          {formatUsd(BigInt(data.topLeak.amountRaw))}, {Math.round(data.topLeak.shareOfLossBps / 100)}% of
          your losses in this period.
        </p>
      )}
    </section>
  );
}
