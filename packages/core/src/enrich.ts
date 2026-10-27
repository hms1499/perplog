import { shortAddress } from "./address";
import { FALLBACK_DISPLAY_DECIMALS, PRICE_DECIMALS } from "./config";
import { createStopIndex } from "./coverage";
import { createExitClassifier } from "./exit-type";
import type { AccountHistory, Address, CostAttribution, EnrichedTrade, MarketInfo } from "./types";
import { notionalRaw, stepDecimals } from "./units";

export function enrichTrades(
  attribution: CostAttribution,
  history: AccountHistory,
  markets: ReadonlyMap<Address, MarketInfo>,
  nowSec: number,
  perplogStopTxs: ReadonlySet<string> = new Set(),
): EnrichedTrade[] {
  const exitType = createExitClassifier(history.liquidations, history.stopOrders, perplogStopTxs);
  const hadStop = createStopIndex(history.stopOrders);
  return attribution.trades.map((t) => {
    const market = markets.get(t.pool);
    return {
      ...t,
      exitType: exitType(t),
      hadStop: hadStop(t, nowSec),
      maxNotional: market ? notionalRaw(t.maxSize, t.entryPrice, market.baseDecimals) : 0n,
      symbol: market?.symbol ?? shortAddress(t.pool),
      baseDecimals: market?.baseDecimals ?? PRICE_DECIMALS,
      sizeDecimals: market ? stepDecimals(market.lotSize, market.baseDecimals) : FALLBACK_DISPLAY_DECIMALS,
      priceDecimals: market ? stepDecimals(market.tickSize, PRICE_DECIMALS) : FALLBACK_DISPLAY_DECIMALS,
    };
  });
}
