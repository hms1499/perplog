export function absBig(x: bigint): bigint {
  return x < 0n ? -x : x;
}

/**
 * Format a raw fixed-point amount: rounds half away from zero, adds thousands
 * separators and never prints a negative zero.
 */
export function formatAmount(raw: bigint, decimals: number, fractionDigits = 2): string {
  const negative = raw < 0n;
  let magnitude = absBig(raw);
  if (decimals > fractionDigits) {
    const divisor = 10n ** BigInt(decimals - fractionDigits);
    magnitude = (magnitude + divisor / 2n) / divisor;
  } else {
    magnitude *= 10n ** BigInt(fractionDigits - decimals);
  }
  const scale = 10n ** BigInt(fractionDigits);
  const whole = (magnitude / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction =
    fractionDigits > 0 ? `.${(magnitude % scale).toString().padStart(fractionDigits, "0")}` : "";
  const sign = negative && magnitude > 0n ? "-" : "";
  return `${sign}${whole}${fraction}`;
}

export function formatUsd(raw: bigint): string {
  return `${formatAmount(raw, 18, 2)} USDso`;
}

/** Quote-raw notional of a base-raw size at an 18-decimal price. */
export function notionalRaw(sizeRaw: bigint, priceRaw: bigint, baseDecimals: number): bigint {
  return (absBig(sizeRaw) * priceRaw) / 10n ** BigInt(baseDecimals);
}

/** Floor of num/den in basis points; 0 when den is 0. */
export function ratioBps(num: bigint, den: bigint): number {
  if (den === 0n) return 0;
  return Number((num * 10_000n) / den);
}

/** Index of the first element of the ascending `values` that is `>= target` (`values.length` if none). */
export function lowerBound(values: readonly number[], target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((values[mid] as number) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Number of elements of the ascending `values` that are `<= target`. */
export function upperBound(values: readonly number[], target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((values[mid] as number) <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Running maximum of `values`, so it can be binary searched. */
export function prefixMax(values: readonly number[]): number[] {
  const out: number[] = [];
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    max = Math.max(max, v);
    out.push(max);
  }
  return out;
}

/** Fraction digits needed to show values that move in steps of `stepRaw` at `decimals` scale (a tick or a lot). */
export function stepDecimals(stepRaw: bigint, decimals: number): number {
  if (stepRaw <= 0n) return decimals;
  let digits = decimals;
  let step = stepRaw;
  while (digits > 0 && step % 10n === 0n) {
    step /= 10n;
    digits -= 1;
  }
  return digits;
}
