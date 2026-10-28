import { formatAmount } from "@perplog/core";

export function fromApiBigint(value: string): bigint {
  return BigInt(value);
}

/** Signed USDso amount with two decimals and a real minus sign, e.g. "+412.50" / "−86.20". */
export function signedUsd(raw: bigint): string {
  return `${raw > 0n ? "+" : raw < 0n ? "−" : ""}${formatAmount(raw < 0n ? -raw : raw, 18, 2)}`;
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

export const EXPLORER_TX = "https://explorer.testnet.somnia.network/tokyo/tx/";
