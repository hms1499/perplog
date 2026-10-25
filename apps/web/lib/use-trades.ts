"use client";

import type { EnrichedTrade, Range } from "@perplog/core";
import { useInfiniteQuery } from "@tanstack/react-query";
import { getJson, type Wire } from "./api";
import { useAccountQuery } from "./use-account";

export type TradePage = { trades: Wire<EnrichedTrade>[]; nextCursor: string | null };

export function useTradePages(address: string, filters: Record<string, string>) {
  return useInfiniteQuery({
    queryKey: [address, "trades-pages", filters],
    initialPageParam: "0",
    queryFn: ({ pageParam }) =>
      getJson<TradePage>(
        `/api/accounts/${address}/trades?${new URLSearchParams({ ...filters, cursor: pageParam, limit: "50" })}`,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Up to 200 trades of the range, for filter options and leak evidence. */
export function useAllTrades(address: string, range: Range) {
  return useAccountQuery<TradePage>(address, "trades", { range, limit: "200" });
}
