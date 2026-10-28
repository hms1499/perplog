"use client";

import type { Address } from "@perplog/core";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { parseRange, RANGES } from "@/lib/use-account";
import { AlertToasts } from "./alert-toasts";
import { AppShell } from "./app-shell";
import { HealthPanel } from "./health-panel";
import { JournalPanel } from "./journal-panel";
import { LeaksPanel } from "./leaks-panel";
import { PlanPanel } from "./plan-panel";
import { PositionsPanel } from "./positions-panel";
import { ReportPanel } from "./report-panel";

const TABS = [
  { value: "health", label: "Health" },
  { value: "journal", label: "Journal" },
  { value: "leaks", label: "Leaks" },
  { value: "positions", label: "Positions" },
  { value: "plan", label: "Plan" },
  { value: "report", label: "Report" },
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

  const rangeControl =
    tab !== "positions" && tab !== "plan" && tab !== "report" ? (
      <nav aria-label="Time range" className="flex rounded-lg border border-line bg-field p-0.5">
        {RANGES.map((r) => (
          <Link
            key={r.value}
            href={href({ range: r.value })}
            aria-current={r.value === range ? "true" : undefined}
            className="rounded-md px-3 py-1 font-medium text-muted text-sm hover:text-head aria-[current=true]:bg-panel aria-[current=true]:text-head"
            scroll={false}
          >
            {r.label}
          </Link>
        ))}
      </nav>
    ) : null;

  return (
    <AppShell address={address} tab={tab} tabs={TABS} href={href} rangeControl={rangeControl}>
      {tab === "health" && <HealthPanel address={address} range={range} />}
      {tab === "journal" && <JournalPanel address={address} range={range} />}
      {tab === "leaks" && <LeaksPanel address={address} range={range} />}
      {tab === "positions" && <PositionsPanel address={address} />}
      {tab === "plan" && <PlanPanel address={address} />}
      {tab === "report" && <ReportPanel address={address} />}
      <AlertToasts account={address} />
    </AppShell>
  );
}
