export interface GapPart {
  label: string;
  raw: bigint;
}

/** The non-zero parts of the PnL gap, each with its share (0..1) of the summed magnitudes, for the split bar. */
export function gapSegments(parts: GapPart[]): Array<GapPart & { share: number }> {
  const nonZero = parts.filter((p) => p.raw !== 0n);
  const total = nonZero.reduce((sum, p) => sum + (p.raw < 0n ? -p.raw : p.raw), 0n);
  if (total === 0n) return [];
  // Shares in millionths keep the bigint division exact enough for a bar width.
  return nonZero.map((p) => ({
    ...p,
    share: Number(((p.raw < 0n ? -p.raw : p.raw) * 1_000_000n) / total) / 1_000_000,
  }));
}
