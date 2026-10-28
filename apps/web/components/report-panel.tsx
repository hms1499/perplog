"use client";

import { type Address, formatAmount, isoWeekStart } from "@perplog/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { WeeklyResponse } from "@/lib/account-service";
import { getJson, type Wire } from "@/lib/api";
import { Button, Label, Panel } from "./ui";

const WEEK_SEC = 7 * 86_400;
const shiftWeek = (week: string, by: number) =>
  isoWeekStart(Date.parse(`${week}T00:00:00Z`) / 1000 + by * WEEK_SEC);

export function ReportPanel({ address }: { address: Address }) {
  const thisWeek = isoWeekStart(Date.now() / 1000);
  const [week, setWeek] = useState(thisWeek);
  const report = useQuery({
    queryKey: ["weekly", address, week],
    queryFn: () => getJson<Wire<WeeklyResponse>>(`/api/accounts/${address}/weekly?week=${week}`),
  });
  const image = `/api/og/report/${address}/${week}`;
  const net = report.data ? BigInt(report.data.netPnlRaw) : null;
  const netText =
    net === null
      ? "my"
      : `${net < 0n ? "−" : net > 0n ? "+" : ""}${formatAmount(net < 0n ? -net : net, 18, 2)} USDso`;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const text = `My dreamDEX perps week: ${netText} net after funding & fees. Where I leak money → via PerpLog @DreamDEXSomnia`;
  const share = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(`${origin}/r/${address}/${week}`)}`;

  return (
    <section className="grid gap-3 py-6">
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Label>Weekly report</Label>
            <p className="mt-1 font-semibold text-head">Week of {week}</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              aria-label="Previous week"
              onClick={() => setWeek((w) => shiftWeek(w, -1))}
            >
              ‹ Previous
            </Button>
            <Button
              variant="ghost"
              aria-label="Next week"
              disabled={week >= thisWeek}
              onClick={() => setWeek((w) => shiftWeek(w, 1))}
            >
              Next ›
            </Button>
          </div>
        </div>
        {/* biome-ignore lint/performance/noImgElement: the OG route already returns a sized PNG */}
        <img
          data-testid="report-image"
          src={image}
          alt={`Weekly report card, week of ${week}`}
          width={1200}
          height={630}
          className="mt-4 h-auto w-full rounded-xl border border-line"
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href={share}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-x px-3 py-2 font-semibold text-[13px] text-head hover:opacity-90"
          >
            Share on X
          </a>
          <a
            href={image}
            download={`perplog-${week}.png`}
            className="rounded-lg border border-line-strong bg-panel px-3 py-2 font-semibold text-[13px] hover:bg-field"
          >
            Download PNG
          </a>
        </div>
        {report.data?.empty && (
          <p className="mt-3 text-muted text-xs">No perps activity for this address yet.</p>
        )}
      </Panel>
    </section>
  );
}
