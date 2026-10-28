// Geometry of the Plan risk ladder (spec §6.4): which prices to mark, which gaps to measure, and where on a
// vertical scale each price sits. Pure, so the SVG only draws what these return.

export type Side = "long" | "short";

export interface Book {
  bestBid: bigint | null;
  bestAsk: bigint | null;
}

export interface LadderQuote {
  refPrice: bigint;
  priceBound: bigint;
  stopPrice: bigint;
  liqPriceEst: bigint | null;
}

export type LadderMark = { kind: "entry" | "ref" | "stop" | "liq" | "bid" | "ask"; price: bigint };
export type LadderBracket = { from: bigint; to: bigint; kind: "loss" | "buffer" };

/**
 * A stop `pct`% away from where the entry would fill: below the best ask for a long (floored to the tick), above
 * the best bid for a short (ceiled), so the shortcut never lands closer to the entry than asked. Null when that
 * side of the book is empty.
 */
export function stopShortcut(side: Side, book: Book, pct: number, tickSize: bigint): bigint | null {
  const p = BigInt(pct);
  if (side === "long") {
    if (book.bestAsk === null) return null;
    return ((book.bestAsk * (100n - p)) / 100n / tickSize) * tickSize;
  }
  if (book.bestBid === null) return null;
  const raw = book.bestBid * (100n + p);
  return ((raw + 100n * tickSize - 1n) / (100n * tickSize)) * tickSize;
}

export function ladderMarks(q: LadderQuote | null, book: Book): LadderMark[] {
  const marks: LadderMark[] = [];
  if (q) {
    marks.push({ kind: "entry", price: q.priceBound }, { kind: "ref", price: q.refPrice });
    marks.push({ kind: "stop", price: q.stopPrice });
    if (q.liqPriceEst !== null) marks.push({ kind: "liq", price: q.liqPriceEst });
  }
  if (book.bestBid !== null) marks.push({ kind: "bid", price: book.bestBid });
  if (book.bestAsk !== null) marks.push({ kind: "ask", price: book.bestAsk });
  return marks;
}

export function ladderBrackets(q: LadderQuote): LadderBracket[] {
  const brackets: LadderBracket[] = [{ from: q.priceBound, to: q.stopPrice, kind: "loss" }];
  if (q.liqPriceEst !== null) brackets.push({ from: q.stopPrice, to: q.liqPriceEst, kind: "buffer" });
  return brackets;
}

/** 18-decimal price → Number with 8 decimals kept: plenty for placing a pixel. */
const toNum = (price: bigint) => Number(price / 10n ** 10n) / 1e8;
const P8 = 10n ** 10n;

/** A linear vertical scale (higher price → smaller y) padded by `pad` of the span, with round ticks. */
export function ladderScale(
  prices: bigint[],
  height: number,
  pad = 0.12,
): { y(price: bigint): number; ticks: bigint[] } {
  if (prices.length === 0) return { y: () => height / 2, ticks: [] };
  const values = prices.map(toNum);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo <= 0) {
    // One price, or all equal: show ±1% around it so the scale has a span.
    const half = Math.abs(lo) * 0.01 || 1;
    lo -= half;
    hi += half;
  }
  const span = hi - lo;
  const top = hi + span * pad;
  const bottom = lo - span * pad;
  const y = (price: bigint) => ((top - toNum(price)) / (top - bottom)) * height;

  // Step of 1, 2 or 5 × 10ⁿ giving about six ticks, as an integer count of 1e-8 price units.
  const raw = (top - bottom) / 6;
  const exp = Math.floor(Math.log10(raw));
  const mantissa = [1, 2, 5, 10].find((m) => m * 10 ** exp >= raw) ?? 10;
  const stepP8 = exp + 8 >= 0 ? BigInt(mantissa) * 10n ** BigInt(exp + 8) : 1n;
  const first = BigInt(Math.ceil((bottom * 1e8) / Number(stepP8)));
  const ticks: bigint[] = [];
  for (let k = first; Number(k * stepP8) / 1e8 <= top && ticks.length < 12; k++) {
    ticks.push(k * stepP8 * P8);
  }
  return { y, ticks };
}

/** |a − b| as a percent of `a`, e.g. the stop's distance from the entry. */
export function pctOf(a: bigint, b: bigint): number {
  if (a === 0n) return 0;
  const d = a > b ? a - b : b - a;
  return Number((d * 1_000_000n) / a) / 10_000;
}
