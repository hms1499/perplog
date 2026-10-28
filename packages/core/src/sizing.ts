import { ENTRY_SLIP_BPS } from "./config";
import type { MarketInfo, Side } from "./types";
import { absBig, notionalRaw } from "./units";

export type EntryQuoteError =
  | "no_liquidity"
  | "stop_wrong_side"
  | "risk_too_small"
  | "stop_beyond_liquidation"
  | "not_priceable";

export interface EntryQuoteInput {
  market: MarketInfo;
  side: Side;
  /** Loss if the stop hits, in quote raw (USDso, 18 decimals). */
  riskRaw: bigint;
  stopPrice: bigint;
  bestBid: bigint | null;
  bestAsk: bigint | null;
  slippageBps?: number;
}

export type EntrySizeOk = {
  ok: true;
  refPrice: bigint;
  qtyRaw: bigint;
  priceBound: bigint;
  notionalRaw: bigint;
  effectiveRiskRaw: bigint;
};
export type EntrySize = EntrySizeOk | { ok: false; error: EntryQuoteError };

const floorToStep = (value: bigint, step: bigint): bigint => (value / step) * step;
const ceilToStep = (value: bigint, step: bigint): bigint => ((value + step - 1n) / step) * step;

const riskOf = (qtyRaw: bigint, refPrice: bigint, stopPrice: bigint, baseDecimals: number): bigint =>
  (qtyRaw * absBig(refPrice - stopPrice)) / 10n ** BigInt(baseDecimals);

/**
 * Risk-based size for a market entry (spec §6.6): a long prices off the best ask, a short off the best bid.
 * The IOC bound snaps inside the slippage, and the size is taken from the WORST fill that bound allows:
 * qty = risk · 10^baseDecimals / |bound − S|, floored to the lot, so "max loss if the stop hits" holds however
 * the entry fills. (The spec sized off P; at a 0.5% bound and a tight stop that understated the loss up to ~2×.)
 */
export function sizeEntry(input: EntryQuoteInput): EntrySize {
  const { market, side, riskRaw, stopPrice } = input;
  const refPrice = side === "long" ? input.bestAsk : input.bestBid;
  if (refPrice === null || refPrice <= 0n) return { ok: false, error: "no_liquidity" };
  if (side === "long" ? stopPrice >= refPrice : stopPrice <= refPrice) {
    return { ok: false, error: "stop_wrong_side" };
  }
  const slip = BigInt(input.slippageBps ?? ENTRY_SLIP_BPS);
  const priceBound =
    side === "long"
      ? floorToStep((refPrice * (10_000n + slip)) / 10_000n, market.tickSize)
      : ceilToStep((refPrice * (10_000n - slip) + 9_999n) / 10_000n, market.tickSize);
  const scale = 10n ** BigInt(market.baseDecimals);
  const qtyRaw = floorToStep((riskRaw * scale) / absBig(priceBound - stopPrice), market.lotSize);
  if (qtyRaw <= 0n || qtyRaw < market.minQuantity) return { ok: false, error: "risk_too_small" };

  return {
    ok: true,
    refPrice,
    qtyRaw,
    priceBound,
    notionalRaw: notionalRaw(qtyRaw, refPrice, market.baseDecimals),
    effectiveRiskRaw: riskOf(qtyRaw, priceBound, stopPrice, market.baseDecimals),
  };
}

/** Applies the margin cap; `capped` is true when maxQtyRaw cut the size. */
export function capEntry(
  size: EntrySizeOk,
  maxQtyRaw: bigint,
  market: MarketInfo,
  stopPrice: bigint,
): (EntrySizeOk & { capped: boolean }) | { ok: false; error: "risk_too_small" } {
  if (size.qtyRaw <= maxQtyRaw) return { ...size, capped: false };
  const qtyRaw = floorToStep(maxQtyRaw, market.lotSize);
  if (qtyRaw <= 0n || qtyRaw < market.minQuantity) return { ok: false, error: "risk_too_small" };
  return {
    ...size,
    qtyRaw,
    notionalRaw: notionalRaw(qtyRaw, size.refPrice, market.baseDecimals),
    effectiveRiskRaw: riskOf(qtyRaw, size.priceBound, stopPrice, market.baseDecimals),
    capped: true,
  };
}

/** Long: blocked when liq ≥ stop. Short: blocked when liq ≤ stop. A null liquidation price never blocks. */
export function stopBeyondLiquidation(side: Side, stopPrice: bigint, liqPrice: bigint | null): boolean {
  if (liqPrice === null) return false;
  return side === "long" ? liqPrice >= stopPrice : liqPrice <= stopPrice;
}
