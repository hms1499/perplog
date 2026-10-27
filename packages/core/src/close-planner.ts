import type { Side } from "./types";
import { absBig } from "./units";

export type QtyMode = "entire" | "fixed";

export type ClosePlan =
  | { action: "send"; isBid: boolean; qtyRaw: bigint }
  | { action: "stop"; event: "position_closed" | "position_flipped" | "filled" }
  | { action: "fail"; reason: "dust_position" };

// Same rule as trades.ts: a zero size counts as long.
const sideOf = (size: bigint): Side => (size >= 0n ? "long" : "short");

const floorToStep = (value: bigint, step: bigint): bigint => (value / step) * step;
const ceilToStep = (value: bigint, step: bigint): bigint => ((value + step - 1n) / step) * step;

/**
 * Decide what to do for a stop given the LIVE position size. Never produces an
 * order that exceeds or flips the position: a sent qty is positive, at most
 * |size|, a multiple of lotSize, and on the closing side.
 *
 * A "fixed" stop without a qtyRaw is treated as "entire".
 */
export function planClose(input: {
  positionSize: bigint;
  stopSide: Side;
  qtyMode: QtyMode;
  qtyRaw: bigint | null;
  closedSoFarRaw: bigint;
  lotSize: bigint;
  minQuantity: bigint;
}): ClosePlan {
  const { positionSize, stopSide, qtyMode, qtyRaw, closedSoFarRaw, lotSize, minQuantity } = input;
  if (lotSize <= 0n) throw new RangeError("lotSize must be positive");

  if (positionSize === 0n) return { action: "stop", event: "position_closed" };
  if (sideOf(positionSize) !== stopSide) return { action: "stop", event: "position_flipped" };

  const abs = absBig(positionSize);
  let target = abs;
  if (qtyMode === "fixed" && qtyRaw !== null) {
    const left = qtyRaw - closedSoFarRaw;
    if (left <= 0n) return { action: "stop", event: "filled" };
    // biome-ignore lint/complexity/useMathMinMax: Math.min does not accept bigint
    target = left < abs ? left : abs;
  }

  let qty = floorToStep(target, lotSize);
  if (qty < minQuantity || qty === 0n) {
    // Too small to place: close the whole position instead, if that is placeable.
    qty = abs >= minQuantity ? floorToStep(abs, lotSize) : 0n;
    if (qty === 0n || qty < minQuantity) return { action: "fail", reason: "dust_position" };
  }
  return { action: "send", isBid: stopSide === "short", qtyRaw: qty };
}

/**
 * Worst acceptable price for a close: a sell floors below the mark, a buy ceils
 * above it, both snapped to the tick on the side that fills more easily.
 */
export function closePriceBound(mark: bigint, stopSide: Side, slipBps: number, tickSize: bigint): bigint {
  const slip = BigInt(slipBps);
  let bound: bigint;
  if (stopSide === "long") {
    const raw = slip >= 10_000n ? 0n : (mark * (10_000n - slip)) / 10_000n;
    bound = floorToStep(raw, tickSize);
  } else {
    const raw = (mark * (10_000n + slip) + 9_999n) / 10_000n;
    bound = ceilToStep(raw, tickSize);
  }
  return bound < tickSize ? tickSize : bound;
}
