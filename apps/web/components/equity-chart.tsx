"use client";

import { formatAmount } from "@perplog/core";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TradePage } from "@/lib/use-trades";

const toNumber = (raw: bigint) => Number(formatAmount(raw, 18, 6).replace(/,/g, ""));

export function EquityChart({ trades }: { trades: TradePage["trades"] }) {
  const closed = trades
    .filter((t) => t.closedAt !== null)
    .sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
  if (closed.length < 2) return null;
  let total = 0n;
  const points = closed.map((t) => {
    total += BigInt(t.netPnl);
    return { at: (t.closedAt ?? 0) * 1000, net: toNumber(total) };
  });
  const last = points.at(-1)?.net ?? 0;
  return (
    <figure data-testid="equity-chart" className="lg:col-span-2">
      <figcaption className="mb-2 font-semibold text-muted">Cumulative net PnL, trade by trade</figcaption>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="at"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(v: number) =>
                new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" })
              }
              stroke="var(--muted)"
              fontSize={12}
            />
            <YAxis stroke="var(--muted)" fontSize={12} width={56} />
            <ReferenceLine y={0} stroke="var(--rule)" />
            <Tooltip
              formatter={(v) => [`${Number(v).toFixed(2)} USDso`, "Net PnL"]}
              labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
            />
            <Line
              type="stepAfter"
              dataKey="net"
              stroke={last >= 0 ? "var(--gain)" : "var(--loss)"}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
