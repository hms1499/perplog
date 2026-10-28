"use client";

import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";
import type { Book } from "./ladder";

/** The live best bid and ask of `pool`, polled every 5 s while the tab is visible; both null when unreadable. */
export function useBook(pool: string | null): Book {
  const book = useQuery({
    queryKey: ["book", pool],
    queryFn: () => getJson<{ bestBid: string | null; bestAsk: string | null }>(`/api/markets/${pool}/book`),
    enabled: pool !== null,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  if (book.isError || !book.data) return { bestBid: null, bestAsk: null };
  return {
    bestBid: book.data.bestBid ? BigInt(book.data.bestBid) : null,
    bestAsk: book.data.bestAsk ? BigInt(book.data.bestAsk) : null,
  };
}
