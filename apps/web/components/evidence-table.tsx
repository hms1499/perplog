"use client";

import { type Address, formatAmount, shortAddress } from "@perplog/core";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ApiError, getJson } from "@/lib/api";
import { ErrorState } from "./error-state";
import { Label, Num, Panel, Pill, StatTile } from "./ui";

interface EvidenceRow {
  kind: "entry" | "stop_close";
  status: string;
  account: Address;
  pool: Address;
  symbol: string | null;
  baseDecimals?: number | null;
  isBid: boolean;
  filledRaw: string | null;
  avgPrice: string | null;
  txHash: string;
  explorerUrl: string;
  createdAt: string;
}

interface Evidence {
  rows: EvidenceRow[];
  totals: { transactions: number; entries: number; stopCloses: number; medianStopLatencyMs: number | null };
}

const time = (iso: string) =>
  new Date(iso).toLocaleString("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });

/** Prices are 18-decimal; show 4 decimals below 10, 2 above. */
const price = (raw: string) => formatAmount(BigInt(raw), 18, BigInt(raw) < 10n * 10n ** 18n ? 4 : 2);

export function EvidenceTable() {
  const q = useQuery({
    queryKey: ["evidence"],
    queryFn: () => getJson<Evidence>("/api/executions"),
    refetchInterval: 15_000,
    retry: false,
  });

  return (
    <div className="grid gap-3 py-6">
      <Panel>
        <h1 className="font-semibold text-[22px] text-head">Every order PerpLog sent, on-chain</h1>
        <p className="mt-1 text-muted">
          Sent by users' linked bot keys on Somnia Tokyo testnet (chain 50383). Nothing here is simulated.
        </p>
      </Panel>
      {q.isPending ? (
        <p className="py-6 text-muted">Reading the log…</p>
      ) : q.error instanceof ApiError && q.error.code === "db_unavailable" ? (
        <Panel>
          <p className="text-muted">
            The evidence log needs PerpLog's database, which this deployment does not have.
          </p>
        </Panel>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Transactions" value={q.data.totals.transactions} />
            <StatTile label="Stop closes" value={q.data.totals.stopCloses} />
            <StatTile label="Plan entries" value={q.data.totals.entries} />
            <StatTile
              label="Median stop latency"
              value={
                q.data.totals.medianStopLatencyMs === null
                  ? "—"
                  : `${(q.data.totals.medianStopLatencyMs / 1000).toFixed(1)} s`
              }
            />
          </div>
          <Panel className="overflow-x-auto">
            {q.data.rows.length === 0 ? (
              <p className="text-muted">No PerpLog transactions yet.</p>
            ) : (
              <table className="w-full min-w-[720px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-line border-b text-left">
                    {["Time (UTC)", "Kind", "Market", "Side", "Filled", "Avg price", "Account", "Tx"].map(
                      (h) => (
                        <th
                          key={h}
                          className={`px-2.5 py-2 font-medium text-muted text-xs ${
                            h === "Filled" || h === "Avg price" ? "text-right" : ""
                          }`}
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {q.data.rows.map((r) => (
                    <tr
                      key={r.txHash}
                      data-testid="evidence-row"
                      className="border-line/60 border-b hover:bg-field"
                    >
                      <td className="px-2.5 py-2.5">
                        <Num text={time(r.createdAt)} />
                      </td>
                      <td className="px-2.5 py-2.5">
                        {r.kind === "stop_close" ? (
                          <Pill tone="brand">Stop close</Pill>
                        ) : (
                          <Pill tone="action">Plan entry</Pill>
                        )}
                        {r.status === "failed" && (
                          <span className="ml-1.5 text-loss text-xs">not filled</span>
                        )}
                      </td>
                      <td className="px-2.5 py-2.5">{r.symbol ?? shortAddress(r.pool)}</td>
                      <td className={`px-2.5 py-2.5 ${r.isBid ? "text-gain" : "text-loss"}`}>
                        {r.isBid ? "Buy" : "Sell"}
                      </td>
                      <td className="px-2.5 py-2.5 text-right">
                        <Num
                          text={
                            r.filledRaw && typeof r.baseDecimals === "number"
                              ? formatAmount(BigInt(r.filledRaw), r.baseDecimals, 4)
                              : (r.filledRaw ?? "—")
                          }
                        />
                      </td>
                      <td className="px-2.5 py-2.5 text-right">
                        <Num text={r.avgPrice ? price(r.avgPrice) : "—"} />
                      </td>
                      <td className="px-2.5 py-2.5">
                        <Link href={`/a/${r.account}`} className="font-mono text-brand hover:underline">
                          {shortAddress(r.account)}
                        </Link>
                      </td>
                      <td className="px-2.5 py-2.5">
                        <a
                          href={r.explorerUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-brand hover:underline"
                        >
                          {shortAddress(r.txHash as Address)} ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <Label className="text-center">Refreshes every 15 seconds</Label>
        </>
      )}
    </div>
  );
}
