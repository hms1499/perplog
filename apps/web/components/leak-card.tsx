"use client";

import { formatUsd, type Leak } from "@perplog/core";
import Link from "next/link";
import { useState } from "react";
import type { Wire } from "@/lib/api";
import type { TradePage } from "@/lib/use-trades";
import { TradeCard } from "./trade-card";

const WHY: Record<Leak["id"], string> = {
  LIQUIDATION_COST: "Liquidation fees plus the realized losses of liquidated trades.",
  NO_STOP_LOSSES: "Losing trades that never had a stop-loss while they were open.",
  FUNDING_DRAG: "Funding you paid while holding positions.",
  SIZE_UP_AFTER_LOSS: "Losses on oversized trades opened within 30 minutes of a losing trade.",
};

export function LeakCard({
  leak,
  address,
  trades,
}: {
  leak: Wire<Leak>;
  address: string;
  trades: TradePage["trades"];
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(false);
  const evidence = trades.filter((t) => leak.evidenceTradeIds.includes(t.id));
  const positionsHref = `/a/${address}?tab=positions${leak.fix === "SHOW_FUNDING" ? "" : "&note=protect"}`;

  return (
    <article data-testid="leak-card" className="border-rule border-b py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 className="font-bold text-xl">{leak.title}</h3>
        <p className="font-extrabold text-2xl text-loss">{formatUsd(BigInt(leak.amountRaw))}</p>
      </div>
      <p className="mt-1 text-muted">
        {WHY[leak.id]} {Math.round(leak.shareOfLossBps / 100)}% of your losses in this period.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="rounded-md border border-rule bg-sheet px-3 py-1.5 font-semibold text-sm"
        >
          {open ? "Hide trades" : "Show trades"}
        </button>
        {leak.fix === "FIXED_RISK" ? (
          <button
            type="button"
            onClick={() => setNote(true)}
            className="rounded-md bg-ink px-3 py-1.5 font-semibold text-paper text-sm"
          >
            Fix
          </button>
        ) : (
          <Link
            href={positionsHref}
            className="rounded-md bg-ink px-3 py-1.5 font-semibold text-paper text-sm"
          >
            Fix
          </Link>
        )}
        <span className="self-center text-muted text-sm">
          {leak.evidenceTradeIds.length} {leak.evidenceTradeIds.length === 1 ? "trade" : "trades"}
        </span>
      </div>
      {note && (
        <p role="status" className="mt-3 text-sm">
          Risk-sized entries (Plan & Place) are coming in the next release.
        </p>
      )}
      {open && (
        <div className="mt-4 border-rule border-l-2 pl-4">
          {evidence.map((t) => (
            <TradeCard key={t.id} trade={t} />
          ))}
        </div>
      )}
    </article>
  );
}
