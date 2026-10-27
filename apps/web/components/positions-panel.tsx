"use client";

import { formatAmount, formatUsd, LIQ_DISTANCE_WARN_BPS, PRICE_DECIMALS, shortAddress } from "@perplog/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { PositionView } from "@/lib/account-service";
import { ApiError, getJson, type Wire } from "@/lib/api";
import { signClass } from "@/lib/format";
import { useProtectionAvailable, useSessionState } from "@/lib/use-protection";
import { ErrorState } from "./error-state";
import { LinkWizard } from "./link-wizard";
import { ProtectForm } from "./protect-form";

type Position = Wire<PositionView>;

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

async function cancelStop(id: string): Promise<void> {
  const res = await fetch(`/api/stops/${id}`, { method: "DELETE" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? "unknown");
}

/** The PerpLog stop on a row, with Cancel while the worker has not picked it up yet. */
function PerplogStopBadge({ position, onCancelled }: { position: Position; onCancelled: () => void }) {
  const stop = position.perplogStop;
  const cancel = useMutation({ mutationFn: cancelStop, onSuccess: onCancelled });
  if (!stop) return null;
  const price = formatAmount(BigInt(stop.triggerPrice), PRICE_DECIMALS, position.priceDecimals);
  const cancellable = stop.status === "armed" || stop.status === "paused";
  return (
    <span className="flex items-center gap-2">
      <span data-testid="perplog-stop" className="rounded-sm border border-ink px-2 py-0.5 text-xs">
        PerpLog stop @ {price} · {stop.status}
      </span>
      {cancellable && (
        <button
          type="button"
          onClick={() => cancel.mutate(stop.id)}
          disabled={cancel.isPending}
          className="font-semibold text-xs underline disabled:opacity-50"
        >
          Cancel stop
        </button>
      )}
      {cancel.isError && (
        <span role="alert" className="text-loss text-xs">
          {cancel.error instanceof ApiError && cancel.error.code === "stop_in_progress"
            ? "Already executing."
            : "Could not cancel."}
        </span>
      )}
    </span>
  );
}

export function PositionsPanel({ address }: { address: string }) {
  const params = useSearchParams();
  const { data, error, isPending, refetch } = useQuery({
    queryKey: [address, "positions"],
    queryFn: () => getJson<Position[]>(`/api/accounts/${address}/positions`),
    refetchInterval: 5000,
  });
  const available = useProtectionAvailable();
  const session = useSessionState(available);
  // `?protect={pool}` (from alert toasts) opens the form for that row, also when it changes while mounted.
  const protectParam = params.get("protect")?.toLowerCase() ?? null;
  const [protectPool, setProtectPool] = useState<string | null>(protectParam);
  useEffect(() => {
    if (protectParam) setProtectPool(protectParam);
  }, [protectParam]);
  const target = data?.find((p) => p.pool.toLowerCase() === protectPool) ?? null;
  const linkedAccount =
    session.data?.status === "linked" ? (session.data.account?.toLowerCase() ?? null) : null;
  const refetchSession = session.refetch;
  const onLinked = useCallback(() => void refetchSession(), [refetchSession]);
  const onChanged = useCallback(() => void refetch(), [refetch]);

  return (
    <section className="py-6">
      {params.get("note") === "protect" && (
        <p role="status" className="mb-4 rounded-sm bg-marker/35 px-3 py-2">
          {available
            ? "Press Protect on an open position to arm a PerpLog stop-loss."
            : "Set a stop-loss on each open position in the dreamDEX app."}
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
                {available && <th className="py-2 pl-4 font-normal">PerpLog</th>}
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
                    {available && (
                      <td className="py-3 pl-4">
                        <span className="flex items-center gap-3">
                          <PerplogStopBadge position={p} onCancelled={onChanged} />
                          <button
                            type="button"
                            onClick={() => setProtectPool(p.pool.toLowerCase())}
                            className="rounded-md border border-ink px-3 py-1 font-semibold"
                          >
                            Protect
                          </button>
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {available && target && (
        <div className="mt-6">
          {session.isPending ? (
            <p className="text-muted">Checking PerpLog's link…</p>
          ) : linkedAccount === address.toLowerCase() ? (
            <ProtectForm
              key={target.pool}
              position={target}
              onArmed={() => {
                setProtectPool(null);
                onChanged();
              }}
            />
          ) : linkedAccount !== null ? (
            <p role="status" className="rounded-sm bg-marker/35 px-3 py-2">
              This browser's PerpLog bot is linked to {shortAddress(linkedAccount as `0x${string}`)}. Open
              that account to protect its positions.
            </p>
          ) : (
            <LinkWizard account={address} onLinked={onLinked} />
          )}
        </div>
      )}
    </section>
  );
}
