"use client";

import { formatUsd, type Leak, type Range } from "@perplog/core";
import Link from "next/link";
import { useState } from "react";
import type { Wire } from "@/lib/api";
import { useTradePages } from "@/lib/use-trades";
import { ErrorState } from "./error-state";
import { TradeCard } from "./trade-card";

const WHY: Record<Leak["id"], string> = {
  LIQUIDATION_COST: "Liquidation fees plus the realized losses of liquidated trades.",
  NO_STOP_LOSSES: "Losing trades that never had a stop-loss while they were open.",
  FUNDING_DRAG: "Funding you paid while holding positions.",
  SIZE_UP_AFTER_LOSS: "Losses on oversized trades opened within 30 minutes of a losing trade.",
};

/** Fetched page by page from the server, so heavy accounts still show every trade. */
function Evidence({ address, range, leak }: { address: string; range: Range; leak: Leak["id"] }) {
  const pages = useTradePages(address, { range, leak });
  if (pages.isPending) return <p className="mt-4 text-muted text-sm">Loading trades…</p>;
  if (pages.error) return <ErrorState error={pages.error} onRetry={() => pages.refetch()} />;
  return (
    <div className="mt-4 border-line border-l-2 pl-4">
      {pages.data.pages
        .flatMap((p) => p.trades)
        .map((t) => (
          <TradeCard key={t.id} trade={t} />
        ))}
      {pages.hasNextPage && (
        <button
          type="button"
          onClick={() => pages.fetchNextPage()}
          disabled={pages.isFetchingNextPage}
          className="mt-4 rounded-md border border-line-strong bg-panel px-3 py-1.5 font-semibold text-sm"
        >
          {pages.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}

export function LeakCard({ leak, address, range }: { leak: Wire<Leak>; address: string; range: Range }) {
  const [open, setOpen] = useState(false);
  const positionsHref = `/a/${address}?tab=positions${leak.fix === "SHOW_FUNDING" ? "" : "&note=protect"}`;

  return (
    <article data-testid="leak-card" className="border-line border-b py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 className="font-bold text-xl">{leak.title}</h3>
        <p className="font-semibold text-head text-2xl text-loss">{formatUsd(BigInt(leak.amountRaw))}</p>
      </div>
      <p className="mt-1 text-muted">
        {WHY[leak.id]} {Math.round(leak.shareOfLossBps / 100)}% of your losses in this period.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="rounded-md border border-line bg-panel px-3 py-1.5 font-semibold text-sm"
        >
          {open ? "Hide trades" : "Show trades"}
        </button>
        <Link
          href={leak.fix === "FIXED_RISK" ? `/a/${address}?tab=plan` : positionsHref}
          className="rounded-md bg-action px-3 py-1.5 font-semibold text-action-ink text-sm"
        >
          Fix
        </Link>
        <span className="self-center text-muted text-sm">
          {leak.evidenceTradeIds.length} {leak.evidenceTradeIds.length === 1 ? "trade" : "trades"}
        </span>
      </div>
      {open && <Evidence address={address} range={range} leak={leak.id} />}
    </article>
  );
}
