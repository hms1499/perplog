import type { Address } from "./types";

const ADDRESS_RE = /^0x[0-9a-f]{40}$/;

/** Trim, lowercase and `0x`-prefix an address; null when it is not 20 hex bytes. */
export function normalizeAddress(input: string): Address | null {
  const lower = input.trim().toLowerCase();
  const withPrefix = lower.startsWith("0x") ? lower : `0x${lower}`;
  return ADDRESS_RE.test(withPrefix) ? (withPrefix as Address) : null;
}

export function shortAddress(address: Address): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
