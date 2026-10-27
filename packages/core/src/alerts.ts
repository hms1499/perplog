/**
 * Whether a position change can leave exposure unprotected: it opened, grew or
 * flipped. A reduction or a close never needs a stop check.
 */
export function needsUnprotectedCheck(prevSize: bigint | undefined, newSize: bigint): boolean {
  if (newSize === 0n) return false;
  const prev = prevSize ?? 0n;
  if (prev === 0n) return true;
  if (prev > 0n !== newSize > 0n) return true;
  return (newSize < 0n ? -newSize : newSize) > (prev < 0n ? -prev : prev);
}
