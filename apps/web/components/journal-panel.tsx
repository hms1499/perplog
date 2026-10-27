"use client";

import type { Range } from "@perplog/core";
import Link from "next/link";
import { useId, useState } from "react";
import { useAllTrades, useTradePages } from "@/lib/use-trades";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { EXIT_LABEL, TradeCard } from "./trade-card";

const selectClass = "rounded-md border border-rule bg-sheet px-2 py-1.5 text-sm";

export function JournalPanel({ address, range }: { address: string; range: Range }) {
  const id = useId();
  const [market, setMarket] = useState("");
  const [exit, setExit] = useState("");
  const [side, setSide] = useState("");
  const filters: Record<string, string> = { range };
  if (market) filters.market = market;
  if (exit) filters.exit = exit;
  if (side) filters.side = side;

  const options = useAllTrades(address, range);
  const pages = useTradePages(address, filters);
  const markets = [...new Map((options.data?.trades ?? []).map((t) => [t.pool, t.symbol])).entries()].sort(
    (a, b) => a[1].localeCompare(b[1]),
  );

  if (pages.error) return <ErrorState error={pages.error} onRetry={() => pages.refetch()} />;
  const trades = pages.data?.pages.flatMap((p) => p.trades) ?? [];
  const noFilters = !market && !exit && !side;

  return (
    <section className="py-6">
      <div className="mb-4 flex flex-wrap gap-4">
        <label htmlFor={`${id}-market`} className="flex items-center gap-2 text-sm">
          Market
          <select
            id={`${id}-market`}
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            className={selectClass}
          >
            <option value="">All markets</option>
            {markets.map(([pool, symbol]) => (
              <option key={pool} value={pool}>
                {symbol}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-exit`} className="flex items-center gap-2 text-sm">
          Exit
          <select
            id={`${id}-exit`}
            value={exit}
            onChange={(e) => setExit(e.target.value)}
            className={selectClass}
          >
            <option value="">Any exit</option>
            {Object.entries(EXIT_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-side`} className="flex items-center gap-2 text-sm">
          Side
          <select
            id={`${id}-side`}
            value={side}
            onChange={(e) => setSide(e.target.value)}
            className={selectClass}
          >
            <option value="">Long and short</option>
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </label>
      </div>

      {pages.isPending ? (
        <p className="py-10 text-muted">Rebuilding your trades…</p>
      ) : trades.length === 0 ? (
        !noFilters ? (
          <p className="py-10 text-muted">No trades match these filters.</p>
        ) : pages.data?.pages[0]?.empty ? (
          <EmptyState />
        ) : (
          <p className="py-10 text-muted">
            No closed trades in this period.
            {range !== "all" && (
              <>
                {" "}
                <Link
                  href={`/a/${address}?tab=journal&range=all`}
                  scroll={false}
                  className="text-ink underline underline-offset-2"
                >
                  See all trades
                </Link>
              </>
            )}
          </p>
        )
      ) : (
        <>
          <div>
            {trades.map((t) => (
              <TradeCard key={t.id} trade={t} />
            ))}
          </div>
          {pages.hasNextPage && (
            <button
              type="button"
              onClick={() => pages.fetchNextPage()}
              disabled={pages.isFetchingNextPage}
              className="mt-6 rounded-md border border-ink px-4 py-2 font-semibold"
            >
              {pages.isFetchingNextPage ? "Loading…" : "Load more"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
