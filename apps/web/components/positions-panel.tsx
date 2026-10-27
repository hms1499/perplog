"use client";

import {
  formatAmount,
  formatUsd,
  LIQ_DISTANCE_WARN_BPS,
  type OpenPosition,
  PRICE_DECIMALS,
} from "@perplog/core";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { getJson, type Wire } from "@/lib/api";
import { signClass } from "@/lib/format";
import { ErrorState } from "./error-state";

function coverage(bps: number): string {
  if (bps === 0) return "None";
  if (bps >= 10_000) return "Full";
  return `${Math.round(bps / 100)}%`;
}

function Distance({ bps }: { bps: number | null }) {
  if (bps === null) return <span className="text-muted">—</span>;
  const danger = bps < LIQ_DISTANCE_WARN_BPS;
  const width = Math.min(100, bps / 30);
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-16 rounded-full bg-rule" aria-hidden>
        <span
          className={`block h-1.5 rounded-full ${danger ? "bg-loss" : "bg-ink"}`}
          style={{ width: `${width}%` }}
        />
      </span>
      <span className={danger ? "font-semibold text-loss" : ""}>{(bps / 100).toFixed(1)}%</span>
    </span>
  );
}

export function PositionsPanel({ address }: { address: string }) {
  const params = useSearchParams();
  const { data, error, isPending, refetch } = useQuery({
    queryKey: [address, "positions"],
    queryFn: () => getJson<Wire<OpenPosition>[]>(`/api/accounts/${address}/positions`),
    refetchInterval: 5000,
  });

  return (
    <section className="py-6">
      {params.get("note") === "protect" && (
        <p role="status" className="mb-4 rounded-sm bg-marker/35 px-3 py-2">
          One-click protection is coming in the next release.
        </p>
      )}
      {isPending ? (
        <p className="py-10 text-muted">Reading open positions…</p>
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.length === 0 ? (
        <p className="py-10 text-lg">No open positions.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-left text-sm [&_td]:whitespace-nowrap [&_td]:pr-4 [&_th]:pr-4">
            <thead className="text-muted">
              <tr className="border-rule border-b">
                <th className="py-2 font-normal">Market</th>
                <th className="py-2 font-normal">Side</th>
                <th className="py-2 text-right font-normal">Size</th>
                <th className="py-2 text-right font-normal">Entry</th>
                <th className="py-2 text-right font-normal">Mark</th>
                <th className="py-2 text-right font-normal">Unrealized PnL</th>
                <th className="py-2 text-right font-normal">Liquidation price</th>
                <th className="py-2 pl-6 font-normal">Distance</th>
                <th className="py-2 font-normal">Stop-loss coverage</th>
                <th className="py-2 text-right font-normal">Funding (24h)</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => {
                const size = BigInt(p.sizeRaw);
                const funding = BigInt(p.fundingLast24hRaw);
                const price = (raw: string | null) =>
                  raw === null ? "—" : formatAmount(BigInt(raw), PRICE_DECIMALS, p.priceDecimals);
                return (
                  <tr key={p.pool} data-testid="position-row" className="border-rule border-b">
                    <td className="py-3 font-bold">{p.symbol}</td>
                    <td className={`py-3 ${p.side === "long" ? "text-gain" : "text-loss"}`}>
                      {p.side === "long" ? "Long" : "Short"}
                    </td>
                    <td className="py-3 text-right">
                      {formatAmount(size < 0n ? -size : size, p.baseDecimals, p.sizeDecimals)}
                    </td>
                    <td className="py-3 text-right">{price(p.entryPrice)}</td>
                    <td className="py-3 text-right">
                      {price(p.markPrice)}
                      {p.markFromIndex && <span className="ml-1 text-muted text-xs">index</span>}
                    </td>
                    <td className={`py-3 text-right ${signClass(BigInt(p.unrealizedPnlRaw))}`}>
                      {formatUsd(BigInt(p.unrealizedPnlRaw))}
                    </td>
                    <td className="py-3 text-right">{price(p.liquidationPrice)}</td>
                    <td className="py-3 pl-6">
                      <Distance bps={p.liqDistanceBps} />
                    </td>
                    <td className={`py-3 ${p.stopCoverageBps === 0 ? "font-semibold text-loss" : ""}`}>
                      {coverage(p.stopCoverageBps)}
                    </td>
                    <td className={`py-3 text-right ${signClass(-funding)}`}>{formatUsd(-funding)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-4 text-muted text-sm">Protect buttons arrive in the next release.</p>
        </div>
      )}
    </section>
  );
}
