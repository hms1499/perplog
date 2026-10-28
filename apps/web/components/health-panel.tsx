"use client";

import { formatAmount, type Leak, type Range } from "@perplog/core";
import Link from "next/link";
import type { HealthResponse } from "@/lib/account-service";
import type { Wire } from "@/lib/api";
import { gapSegments } from "@/lib/breakdown";
import { formatTime, pct, signedUsd } from "@/lib/format";
import { useAccountQuery } from "@/lib/use-account";
import { EmptyState } from "./empty-state";
import { EquityChart } from "./equity-chart";
import { ErrorState } from "./error-state";
import { MeasureBracket } from "./measure-bracket";
import { ReconcileBadge } from "./reconcile-badge";
import { BreakdownRow, Label, Num, Panel } from "./ui";

const RANGE_LABEL: Record<Range, string> = { "7d": "Last 7 days", "30d": "Last 30 days", all: "All time" };

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

  const parts = [
    { label: "Funding paid", raw: -funding },
    { label: "Liquidation fees", raw: -liquidationFees },
    { label: "Trading & builder fees", raw: -tradingFees },
  ];
  const segments = gapSegments(parts);

  return (
    <section className="grid gap-4">
      <Panel className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Label>
            {RANGE_LABEL[range]} · {data.tradeCount} closed {data.tradeCount === 1 ? "trade" : "trades"}
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <ReconcileBadge
              reconcile={data.reconcile}
              truncated={data.truncated}
              chainReadFailed={data.chainReadFailed}
            />
            <span className="text-muted text-xs">Data as of {formatTime(data.asOfTimestamp)}</span>
          </div>
        </div>

        <div data-testid="health-gap" className="mt-5">
          <MeasureBracket
            top={
              <div>
                <Label>The app shows (realized)</Label>
                <Num text={signedUsd(realized)} className="mt-1 block text-[28px] text-muted leading-none" />
              </div>
            }
            bottom={
              <div>
                <Label className="font-medium text-head">Your true net PnL</Label>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                  <Num
                    raw={net}
                    tone="auto"
                    text={signedUsd(net)}
                    className="font-semibold text-[clamp(32px,4vw,44px)] leading-none tracking-[-1px]"
                  />
                  <span className="text-base text-muted">USDso</span>
                </div>
              </div>
            }
            label={`${signedUsd(net - realized)} not shown by the app`}
          />
        </div>

        <div className="mt-6 border-line border-t pt-5">
          <Label className="mb-3">Where the {formatAmount(gap < 0n ? -gap : gap, 18, 2)} went</Label>
          {segments.length > 0 && (
            <div className="mb-4 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-field">
              {segments.map((s) => (
                <div
                  key={s.label}
                  title={`${s.label} ${signedUsd(s.raw)}`}
                  className={s.raw < 0n ? "bg-loss" : "bg-gain"}
                  style={{ width: `${Math.max(s.share * 100, 1)}%` }}
                />
              ))}
            </div>
          )}
          <div data-testid="health-breakdown" className="grid gap-x-10 md:grid-cols-2">
            <BreakdownRow
              label="Realized PnL"
              value={<Num raw={realized} tone="auto" text={signedUsd(realized)} />}
            />
            <BreakdownRow
              label="Funding paid"
              value={<Num raw={-funding} tone="auto" text={signedUsd(-funding)} />}
            />
            <BreakdownRow
              label="Liquidation fees"
              value={<Num raw={-liquidationFees} tone="auto" text={signedUsd(-liquidationFees)} />}
            />
            {tradingFees !== 0n && (
              <BreakdownRow
                label="Trading & builder fees"
                value={<Num raw={-tradingFees} tone="auto" text={signedUsd(-tradingFees)} />}
              />
            )}
            <BreakdownRow label="Net PnL" value={<Num raw={net} tone="auto" text={signedUsd(net)} />} total />
          </div>
        </div>
      </Panel>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel>
          <EquityChart points={data.equity} />
        </Panel>
        <div className="grid content-start gap-4">
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
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={fixOf(leak, address).href}
                  className="rounded-lg bg-action px-3 py-2 font-semibold text-[13px] text-action-ink hover:bg-action-hover"
                >
                  {fixOf(leak, address).label}
                </Link>
                <Link
                  href={`/a/${address}?tab=leaks&range=${range}`}
                  className="rounded-lg border border-line-strong px-3 py-2 font-semibold text-[13px] hover:bg-field"
                >
                  See trades
                </Link>
              </div>
            </section>
          )}
          <section className="grid grid-cols-3 divide-x divide-line rounded-[10px] border border-line bg-panel">
            <Stat label="Win rate" value={pct(data.winRatePct)} />
            <Stat
              label="No stop"
              value={pct(data.tradesWithoutStopPct)}
              warn={data.tradesWithoutStopPct > 50}
            />
            <Stat label="Trades" value={String(data.tradeCount)} />
          </section>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="px-4 py-3.5">
      <Label>{label}</Label>
      <div
        className={
          warn ? "mt-1 text-[22px] text-warn tabular-nums" : "mt-1 text-[22px] text-head tabular-nums"
        }
      >
        {value}
      </div>
    </div>
  );
}
