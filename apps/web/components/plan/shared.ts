// Wire shapes and copy shared by the Plan tab's pieces.

import type { Side } from "@/lib/ladder";

export type { Side };

export interface QuoteView {
  qtyRaw: string;
  refPrice: string;
  stopPrice: string;
  priceBound: string;
  notionalRaw: string;
  effectiveRiskRaw: string;
  capped: boolean;
  liqPriceEst: string | null;
  leverageEstBps: string | null;
  warnings: string[];
}

export interface PlanView {
  id: string;
  status: "pending_entry" | "entered" | "partially_entered" | "entry_failed";
  stopId: string | null;
  txHash: string | null;
}

export const QUOTE_ERRORS: Record<string, (side: Side) => string> = {
  no_liquidity: (side) => `No resting ${side === "long" ? "asks" : "bids"} on the book right now.`,
  stop_wrong_side: (side) =>
    side === "long"
      ? "Your stop must be below the entry price for a long."
      : "Your stop must be above the entry price for a short.",
  risk_too_small: () => "That risk is too small for one lot on this market.",
  stop_beyond_liquidation: () => "Stop is beyond your liquidation price; you would be liquidated first",
  not_priceable: () => "The market's mark price is stale right now; try again in a moment.",
  unknown_pool: () => "Unknown market.",
  invalid_input: () => "Enter a positive risk and stop price.",
};

export const quoteErrorText = (code: string, side: Side): string =>
  (QUOTE_ERRORS[code] ?? (() => "Could not read the market. Try again."))(side);
