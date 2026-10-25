"use client";

import type { Leak, Range } from "@perplog/core";
import type { Wire } from "@/lib/api";
import { useAccountQuery } from "@/lib/use-account";
import { useAllTrades } from "@/lib/use-trades";
import { ErrorState } from "./error-state";
import { LeakCard } from "./leak-card";

export function LeaksPanel({ address, range }: { address: string; range: Range }) {
  const leaks = useAccountQuery<Wire<Leak>[]>(address, "leaks", { range });
  const trades = useAllTrades(address, range);
  if (leaks.isPending) return <p className="py-10 text-muted">Looking for leaks…</p>;
  if (leaks.error) return <ErrorState onRetry={() => leaks.refetch()} />;
  if (leaks.data.length === 0) return <p className="py-10 text-lg">No leaks found in this period.</p>;
  return (
    <section className="py-2">
      {leaks.data.map((leak) => (
        <LeakCard key={leak.id} leak={leak} address={address} trades={trades.data?.trades ?? []} />
      ))}
    </section>
  );
}
