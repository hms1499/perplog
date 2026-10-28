import {
  type Address,
  capEntry,
  type EntryQuoteError,
  normalizeAddress,
  type Side,
  sizeEntry,
  stopBeyondLiquidation,
} from "@perplog/core";
import { z } from "zod";
import { chain } from "./chain";

/** Raw decimal integers only (no sign, fraction or exponent); 78 digits is the column's width. */
const rawAmount = z.string().regex(/^[0-9]{1,78}$/);

export const QuoteBody = z.object({
  account: z.string().min(1).max(100),
  pool: z.string().min(1).max(100),
  side: z.enum(["long", "short"]),
  riskRaw: rawAmount,
  stopPrice: rawAmount,
});

export interface QuoteInput {
  account: Address;
  pool: Address;
  side: Side;
  riskRaw: bigint;
  stopPrice: bigint;
}

export type Quote =
  | {
      ok: true;
      qtyRaw: bigint;
      refPrice: bigint;
      /** The requested stop snapped to the tick away from the entry. */
      stopPrice: bigint;
      priceBound: bigint;
      notionalRaw: bigint;
      effectiveRiskRaw: bigint;
      capped: boolean;
      liqPriceEst: bigint | null;
      leverageEstBps: bigint | null;
      warnings: string[];
    }
  | { ok: false; error: EntryQuoteError | "unknown_pool" | "invalid_input" };

export const CAPPED_WARNING = "Capped by your available margin; effective risk shown.";

/** Parses a quote body: addresses normalized, amounts positive bigints; null when anything is invalid. */
export function parseQuoteBody(raw: unknown): QuoteInput | null {
  const parsed = QuoteBody.safeParse(raw);
  if (!parsed.success) return null;
  const account = normalizeAddress(parsed.data.account);
  const pool = normalizeAddress(parsed.data.pool);
  const riskRaw = BigInt(parsed.data.riskRaw);
  const stopPrice = BigInt(parsed.data.stopPrice);
  if (!account || !pool || riskRaw === 0n || stopPrice === 0n) return null;
  return { account, pool, side: parsed.data.side, riskRaw, stopPrice };
}

/** Sizes a market entry from live reads (spec §6.6). Shared by /quote and POST /api/plans so both agree. */
export async function quoteEntry(input: QuoteInput): Promise<Quote> {
  const market = (await chain.markets()).find((m) => m.pool === input.pool);
  if (!market) return { ok: false, error: "unknown_pool" };
  const tick = market.tickSize;
  // Away from the entry: a long's stop floors, a short's ceils.
  const stopPrice =
    input.side === "long" ? (input.stopPrice / tick) * tick : ((input.stopPrice + tick - 1n) / tick) * tick;

  // A stop that snaps to 0 would never trigger (`mark ≤ 0`): the position would look protected but is not.
  if (stopPrice <= 0n) return { ok: false, error: "invalid_input" };

  const book = await chain.bookTop(input.pool);
  const size = sizeEntry({ market, side: input.side, riskRaw: input.riskRaw, stopPrice, ...book });
  if (!size.ok) return size;

  const isBid = input.side === "long";
  const maxQty = await chain.maxOrderSize(input.account, input.pool, isBid, size.priceBound);
  if (maxQty === null) return { ok: false, error: "not_priceable" };
  const capped = capEntry(size, maxQty, market, stopPrice);
  if (!capped.ok) return capped;

  const preview = await chain.liquidationPreview(
    input.account,
    input.pool,
    isBid,
    capped.qtyRaw,
    size.refPrice,
  );
  if (preview === null) return { ok: false, error: "not_priceable" };
  if (stopBeyondLiquidation(input.side, stopPrice, preview.liqPrice)) {
    return { ok: false, error: "stop_beyond_liquidation" };
  }
  return {
    ok: true,
    qtyRaw: capped.qtyRaw,
    refPrice: capped.refPrice,
    stopPrice,
    priceBound: capped.priceBound,
    notionalRaw: capped.notionalRaw,
    effectiveRiskRaw: capped.effectiveRiskRaw,
    capped: capped.capped,
    liqPriceEst: preview.liqPrice,
    leverageEstBps: preview.leverageBps,
    warnings: capped.capped ? [CAPPED_WARNING] : [],
  };
}
