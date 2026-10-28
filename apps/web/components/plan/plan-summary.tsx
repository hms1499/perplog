import { formatAmount, type MarketInfo, PRICE_DECIMALS, stepDecimals } from "@perplog/core";
import type { Wire } from "@/lib/api";
import { BreakdownRow, Label, Num, WarnBox } from "../ui";
import type { QuoteView, Side } from "./shared";

/** What PerpLog will send: the size it worked out, and the numbers behind it (spec §6.5). */
export function PlanSummary({
  quote: q,
  market,
  side,
}: {
  quote: QuoteView | null;
  market: Wire<MarketInfo>;
  side: Side;
}) {
  const sizeDp = stepDecimals(BigInt(market.lotSize), market.baseDecimals);
  const priceDp = stepDecimals(BigInt(market.tickSize), PRICE_DECIMALS);
  const price = (raw: string) => formatAmount(BigInt(raw), PRICE_DECIMALS, priceDp);
  const base = market.symbol.replace(/-PERP$/i, "");
  return (
    <div>
      <Label>PerpLog sizes it for you</Label>
      {!q ? (
        <p className="mt-3 text-muted">The size appears here once your stop is quoted.</p>
      ) : (
        <>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5">
            <Num
              text={formatAmount(BigInt(q.qtyRaw), market.baseDecimals, sizeDp)}
              className="font-semibold text-[44px] text-head leading-tight tracking-[-1px]"
            />
            <span className="text-muted">
              {base} · {side}
            </span>
          </div>
          <div className="mt-2.5">
            <BreakdownRow
              label="Notional"
              value={<Num text={`${formatAmount(BigInt(q.notionalRaw), 18, 2)} USDso`} />}
            />
            <BreakdownRow label="Entry (IOC, worst price)" value={<Num text={price(q.priceBound)} />} />
            <BreakdownRow
              label="Est. liquidation price"
              value={<Num text={q.liqPriceEst ? price(q.liqPriceEst) : "—"} />}
            />
            <BreakdownRow
              label="Est. leverage"
              value={
                <Num text={q.leverageEstBps ? `${(Number(q.leverageEstBps) / 10_000).toFixed(1)}×` : "—"} />
              }
            />
            <BreakdownRow
              label="Risk if the stop hits"
              value={<Num tone="loss" text={`−${formatAmount(BigInt(q.effectiveRiskRaw), 18, 2)} USDso`} />}
            />
          </div>
          {q.warnings.map((w) => (
            <div key={w} className="mt-2.5">
              <WarnBox>{w}</WarnBox>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
