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

  // The coarsest 1, 2 or 5 × 10ⁿ step that still gives at least four ticks, counted in 1e-8 price units.
  // Ticks never go below zero: a price scale has nothing to label there.
  const exp = Math.floor(Math.log10((top - bottom) / 4));
  const candidates = [exp, exp - 1].flatMap((e) => [5, 2, 1].map((m) => m * 10 ** e));
  let ticks: bigint[] = [];
  for (const step of candidates) {
    const stepP8 = BigInt(Math.max(1, Math.round(step * 1e8)));
    const first = BigInt(Math.max(0, Math.ceil((bottom * 1e8) / Number(stepP8))));
    const next: bigint[] = [];
    for (let k = first; Number(k * stepP8) / 1e8 <= top && next.length < 12; k++) next.push(k * stepP8 * P8);
    ticks = next;
    if (ticks.length >= 4) break;
  }
  return { y, ticks };
}

/** |a − b| as a percent of `ref`, e.g. the buffer between the stop and liquidation against the entry. */
export function gapPct(a: bigint, b: bigint, ref: bigint): number {
  if (ref === 0n) return 0;
  const d = a > b ? a - b : b - a;
  return Number((d * 1_000_000n) / ref) / 10_000;
}

/** |a − b| as a percent of `a`, e.g. the stop's distance from the entry. */
export function pctOf(a: bigint, b: bigint): number {
  if (a === 0n) return 0;
  const d = a > b ? a - b : b - a;
  return Number((d * 1_000_000n) / a) / 10_000;
}
