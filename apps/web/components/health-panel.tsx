"use client";

import { formatAmount, type Leak, type Range } from "@perplog/core";
import Link from "next/link";
import type { HealthResponse } from "@/lib/account-service";
import type { Wire } from "@/lib/api";
import { formatTime, pct } from "@/lib/format";
import { useAccountQuery } from "@/lib/use-account";
import { EmptyState } from "./empty-state";
import { EquityChart } from "./equity-chart";
import { ErrorState } from "./error-state";
import { ReconcileBadge } from "./reconcile-badge";
import { BreakdownRow, Label, Num, Panel, StatTile } from "./ui";

const RANGE_LABEL: Record<Range, string> = { "7d": "Last 7 days", "30d": "Last 30 days", all: "All time" };

/** Signed USDso amount with two decimals, e.g. "+412.50" / "−86.20". */
const signed = (raw: bigint): string =>
  `${raw > 0n ? "+" : raw < 0n ? "−" : ""}${formatAmount(raw < 0n ? -raw : raw, 18, 2)}`;

function fixOf(leak: Wire<Leak>, address: string): { href: string; label: string } {
  if (leak.id === "SIZE_UP_AFTER_LOSS") {
    return { href: `/a/${address}?tab=plan`, label: "Plan a risk-sized trade" };
  }
  return { href: `/a/${address}?tab=positions&note=protect`, label: "Protect open positions" };
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
  const liquidationFees = BigInt(data.liquidationFeesRaw);
  const tradingFees = BigInt(data.tradingFeesRaw);
  const net = BigInt(data.netPnlRaw);
  const gap = realized - net;
  const leak = data.topLeak;

  return (
    <section className="grid items-start gap-3 py-6 lg:grid-cols-[1.25fr_1fr]">
      <Panel>
        <div data-testid="health-gap">
          <Label>
            {RANGE_LABEL[range]} · {data.tradeCount} closed {data.tradeCount === 1 ? "trade" : "trades"}
          </Label>
          <div className="mt-4 grid gap-[18px] sm:grid-cols-2">
            <div>
              <Label>The app shows (realized)</Label>
              <Num
                raw={realized}
                tone="auto"
                text={signed(realized)}
                className="mt-1.5 block text-3xl opacity-80"
              />
            </div>
            <div>
              <Label className="font-semibold text-head">Your true net PnL</Label>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                <Num
                  raw={net}
                  tone="auto"
                  text={signed(net)}
                  className="font-semibold text-[clamp(30px,3vw,44px)] tracking-[-1px]"
                />
                <span className="text-base text-muted">USDso</span>
              </div>
            </div>
          </div>
        </div>
        <div className="my-3.5 h-px bg-line" />
        <div data-testid="health-breakdown">
          <Label className="mb-2">Where the {formatAmount(gap < 0n ? -gap : gap, 18, 2)} went</Label>
          <BreakdownRow
            label="Realized PnL"
            value={<Num raw={realized} tone="auto" text={signed(realized)} />}
          />
          <BreakdownRow
            label="Funding paid"
            value={<Num raw={-funding} tone="auto" text={signed(-funding)} />}
          />
          <BreakdownRow
            label="Liquidation fees"
            value={<Num raw={-liquidationFees} tone="auto" text={signed(-liquidationFees)} />}
          />
          {tradingFees !== 0n && (
            <BreakdownRow
              label="Trading & builder fees"
              value={<Num raw={-tradingFees} tone="auto" text={signed(-tradingFees)} />}
            />
          )}
          <BreakdownRow label="Net PnL" value={<Num raw={net} tone="auto" text={signed(net)} />} total />
        </div>
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <ReconcileBadge
            reconcile={data.reconcile}
            truncated={data.truncated}
            chainReadFailed={data.chainReadFailed}
          />
          <span className="rounded-full border border-line bg-field px-2.5 py-1 text-muted text-xs">
            Data as of {formatTime(data.asOfTimestamp)}
          </span>
        </div>
      </Panel>

      <div className="grid content-start gap-3">
        {leak && (
          <section data-testid="top-leak" className="rounded-[10px] border border-loss/40 bg-panel p-5">
            <Label className="text-loss">Top leak</Label>
            <p className="mt-1.5 font-semibold text-[17px] text-head">
              {leak.title}:{" "}
              <Num
                raw={-BigInt(leak.amountRaw)}
                tone="loss"
                text={formatAmount(BigInt(leak.amountRaw), 18, 2)}
              />
            </p>
            <p className="mt-1 text-muted">
              {Math.round(leak.shareOfLossBps / 100)}% of your losses in this period
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={fixOf(leak, address).href}
                className="rounded-lg bg-action px-3 py-2 font-semibold text-[13px] text-action-ink hover:bg-action-hover"
              >
                {fixOf(leak, address).label}
              </Link>
              <Link
                href={`/a/${address}?tab=leaks&range=${range}`}
                className="rounded-lg border border-line-strong bg-panel px-3 py-2 font-semibold text-[13px] hover:bg-field"
              >
                See trades
              </Link>
            </div>
          </section>
        )}
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Win rate" value={pct(data.winRatePct)} />
          <StatTile
            label="No stop"
            value={pct(data.tradesWithoutStopPct)}
            tone={data.tradesWithoutStopPct > 50 ? "warn" : "head"}
          />
          <StatTile label="Trades" value={data.tradeCount} />
        </div>
        <Panel className="p-3.5">
          <EquityChart points={data.equity} />
        </Panel>
      </div>
    </section>
  );
}
