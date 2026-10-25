export function fromApiBigint(value: string): bigint {
  return BigInt(value);
}

export function pct(n: number): string {
  return `${n}%`;
}

export function signClass(raw: bigint): string {
  if (raw > 0n) return "text-gain";
  if (raw < 0n) return "text-loss";
  return "text-ink";
}

export function formatTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
