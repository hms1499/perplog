"use client";

import { type Address, shortAddress } from "@perplog/core";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { parseRange, RANGES } from "@/lib/use-account";
import { AlertToasts } from "./alert-toasts";
import { HealthPanel } from "./health-panel";
import { JournalPanel } from "./journal-panel";
import { LeaksPanel } from "./leaks-panel";
import { PositionsPanel } from "./positions-panel";
import { WatchButton } from "./watch-button";

const TABS = [
  { value: "health", label: "Health" },
  { value: "journal", label: "Journal" },
  { value: "leaks", label: "Leaks" },
  { value: "positions", label: "Positions" },
] as const;

type Tab = (typeof TABS)[number]["value"];

export function AccountView({ address }: { address: Address }) {
  const params = useSearchParams();
  const tab = (TABS.find((t) => t.value === params.get("tab"))?.value ?? "health") as Tab;
  const range = parseRange(params.get("range"));
  const href = (next: { tab?: Tab; range?: string }) => {
    const q = new URLSearchParams(params);
    if (next.tab) q.set("tab", next.tab);
    if (next.range) q.set("range", next.range);
    return `/a/${address}?${q.toString()}`;
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 pt-8">
        <div>
          <p className="text-muted text-sm">Trading account</p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-extrabold text-3xl tracking-tight" title={address}>
              {shortAddress(address)}
            </h1>
            <WatchButton account={address} />
          </div>
        </div>
        {tab !== "positions" && (
          <nav aria-label="Time range" className="flex rounded-md border border-rule bg-sheet p-0.5">
            {RANGES.map((r) => (
              <Link
                key={r.value}
                href={href({ range: r.value })}
                aria-current={r.value === range ? "true" : undefined}
                className="rounded px-3 py-1 font-semibold text-sm aria-[current=true]:bg-ink aria-[current=true]:text-paper"
                scroll={false}
              >
                {r.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
      <nav aria-label="Account sections" className="mt-6 flex gap-6 border-rule border-b">
        {TABS.map((t) => (
          <Link
            key={t.value}
            href={href({ tab: t.value })}
            aria-current={t.value === tab ? "page" : undefined}
            className="-mb-px border-transparent border-b-2 pb-2 font-semibold text-muted aria-[current=page]:border-ink aria-[current=page]:text-ink"
            scroll={false}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "health" && <HealthPanel address={address} range={range} />}
      {tab === "journal" && <JournalPanel address={address} range={range} />}
      {tab === "leaks" && <LeaksPanel address={address} range={range} />}
      {tab === "positions" && <PositionsPanel address={address} />}
      <AlertToasts account={address} />
    </div>
  );
}
