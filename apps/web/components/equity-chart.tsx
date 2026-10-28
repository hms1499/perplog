"use client";

import { type EquityPoint, formatAmount } from "@perplog/core";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Wire } from "@/lib/api";

const toNumber = (raw: bigint) => Number(formatAmount(raw, 18, 6).replace(/,/g, ""));

export function EquityChart({ points: equity }: { points: Wire<EquityPoint>[] }) {
  if (equity.length < 2) return null;
  const points = equity.map((p) => ({ at: p.at * 1000, net: toNumber(BigInt(p.netRaw)) }));
  return (
    <figure data-testid="equity-chart">
      <figcaption className="mb-3 font-medium text-head">Cumulative net PnL, trade by trade</figcaption>
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
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
            <ReferenceLine y={0} stroke="var(--line-strong)" />
            <Tooltip
              contentStyle={{
                background: "var(--panel)",
                border: "1px solid var(--line)",
                borderRadius: 8,
                color: "var(--text)",
              }}
              cursor={{ stroke: "var(--line-strong)" }}
              formatter={(v) => [`${Number(v).toFixed(2)} USDso`, "Net PnL"]}
              labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
            />
            <Line
              type="stepAfter"
              dataKey="net"
              stroke="var(--brand-line)"
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
