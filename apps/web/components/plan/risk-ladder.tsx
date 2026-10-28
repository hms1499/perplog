"use client";

import { formatAmount, PRICE_DECIMALS } from "@perplog/core";
import { useEffect, useRef, useState } from "react";
import { type Book, type LadderQuote, ladderBrackets, ladderMarks, ladderScale, pctOf } from "@/lib/ladder";
import { WarnBox } from "../ui";
import type { QuoteView, Side } from "./shared";

const HEIGHT = 380;
/** Below this width the gutters shrink and the rule labels drop their explanation. */
const NARROW = 480;
const GLIDE = { transition: "transform 200ms ease-out, d 200ms ease-out" } as const;

const toLadder = (q: QuoteView): LadderQuote => ({
  refPrice: BigInt(q.refPrice),
  priceBound: BigInt(q.priceBound),
  stopPrice: BigInt(q.stopPrice),
  liqPriceEst: q.liqPriceEst ? BigInt(q.liqPriceEst) : null,
});

const STYLE = {
  entry: { stroke: "var(--head)", width: 1.5, dash: undefined, label: "Entry (worst)", short: "Entry" },
  stop: { stroke: "var(--brand)", width: 2, dash: undefined, label: "Stop · held by PerpLog", short: "Stop" },
  liq: { stroke: "var(--loss)", width: 1.5, dash: "5 4", label: "Liquidation (est.)", short: "Liq." },
} as const;

/**
 * The Plan's risk ladder (spec §6.4): entry, stop and liquidation on one price scale, with the max loss measured
 * between entry and stop and the buffer between stop and liquidation.
 */
export function RiskLadder({
  quote,
  book,
  priceDp,
  side,
  updating,
  error,
  emptyText,
}: {
  quote: QuoteView | null;
  book: Book;
  priceDp: number;
  side: Side;
  updating: boolean;
  error: string | null;
  emptyText: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(280, Math.floor(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (error) {
    return (
      <div ref={ref}>
        <WarnBox tone="loss">{error}</WarnBox>
      </div>
    );
  }

  const q = quote ? toLadder(quote) : null;
  const marks = ladderMarks(q, book);
  const scale = ladderScale(
    marks.map((m) => m.price),
    HEIGHT,
  );
  const price = (raw: bigint) => formatAmount(raw, PRICE_DECIMALS, priceDp);
  const narrow = width < NARROW;
  const AXIS = narrow ? 58 : 72; // left gutter for tick labels
  const right = width - (narrow ? 104 : 128); // right gutter for the brackets and their labels
  // Labels sit on the side of each rule away from its neighbour: for a long the stop and liquidation are below.
  const above = (kind: "entry" | "stop" | "liq") => (kind === "entry") === (side === "long");
  const maxLoss = quote ? formatAmount(BigInt(quote.effectiveRiskRaw), 18, 2) : null;
  const summary = q
    ? `Entry ${price(q.priceBound)}, stop ${price(q.stopPrice)}, liquidation ${
        q.liqPriceEst !== null ? price(q.liqPriceEst) : "not estimated"
      }, max loss ${maxLoss} USDso`
    : "Price scale around the current bid and ask";

  return (
    <div ref={ref} className="relative">
      {updating && <span className="absolute top-0 right-0 text-muted text-xs">Updating…</span>}
      <svg
        role="img"
        aria-label={summary}
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        className={updating ? "max-w-full opacity-60" : "max-w-full"}
      >
        <line x1={AXIS - 8} x2={AXIS - 8} y1={0} y2={HEIGHT} stroke="var(--line-strong)" />
        {scale.ticks.map((t) => (
          <g key={t.toString()} style={{ ...GLIDE, transform: `translateY(${scale.y(t)}px)` }}>
            <line x1={AXIS - 12} x2={AXIS - 8} stroke="var(--line-strong)" />
            <line x1={AXIS} x2={right} stroke="var(--line)" strokeDasharray="2 6" />
            <text x={AXIS - 16} dy="0.32em" textAnchor="end" fontSize={narrow ? 10 : 11} fill="var(--muted)">
              {price(t)}
            </text>
          </g>
        ))}

        {marks
          .filter((m) => m.kind === "bid" || m.kind === "ask")
          .map((m) => (
            <g key={m.kind} style={{ ...GLIDE, transform: `translateY(${scale.y(m.price)}px)` }}>
              <line x1={AXIS - 8} x2={AXIS} stroke="var(--muted)" strokeWidth={2} />
            </g>
          ))}

        {q &&
          marks.map((m) => {
            if (m.kind !== "entry" && m.kind !== "stop" && m.kind !== "liq") return null;
            const style = STYLE[m.kind];
            return (
              <g key={m.kind} style={{ ...GLIDE, transform: `translateY(${scale.y(m.price)}px)` }}>
                <line
                  x1={AXIS}
                  x2={right}
                  stroke={style.stroke}
                  strokeWidth={style.width}
                  strokeDasharray={style.dash}
                />
                <text
                  x={right}
                  y={above(m.kind) ? -7 : 16}
                  textAnchor="end"
                  fontSize={12}
                  fill={style.stroke}
                  fontWeight={500}
                >
                  {narrow ? style.short : style.label} · {price(m.price)}
                </text>
              </g>
            );
          })}

        {q &&
          ladderBrackets(q).map((b) => {
            const y1 = scale.y(b.from);
            const y2 = scale.y(b.to);
            const x = right + 12;
            const mid = (y1 + y2) / 2;
            const pct = pctOf(q.priceBound, b.to) - (b.kind === "buffer" ? pctOf(q.priceBound, b.from) : 0);
            return (
              <g key={b.kind}>
                <path
                  d={`M ${x - 6} ${y1} H ${x} V ${y2} H ${x - 6}`}
                  fill="none"
                  stroke="var(--brand)"
                  strokeWidth={1.5}
                  style={GLIDE}
                />
                <text x={x + 8} y={mid} fontSize={12} fill="var(--brand)" fontWeight={500}>
                  <tspan x={x + 8} dy="-0.2em">
                    {b.kind === "loss" ? `−${maxLoss} USDso` : "Buffer"}
                  </tspan>
                  <tspan x={x + 8} dy="1.3em" fill="var(--muted)">
                    {pct.toFixed(1)}%
                  </tspan>
                </text>
              </g>
            );
          })}

        {!q && (
          <text x={width / 2} y={HEIGHT / 2} textAnchor="middle" fontSize={14} fill="var(--muted)">
            {emptyText}
          </text>
        )}
      </svg>
    </div>
  );
}
