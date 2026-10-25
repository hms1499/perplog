import type { AccountHistory, Address, MarketInfo, OpenPosition } from "./types";

export interface AccountFixture {
  account: Address;
  asOfBlock: bigint;
  asOfTimestamp: number;
  collateralRaw: bigint;
  history: AccountHistory;
  markets: MarketInfo[];
  openPositions: OpenPosition[];
}

const BIGINT_KEY = "$bigint";

export function writeFixture(fixture: AccountFixture): string {
  return `${JSON.stringify(
    fixture,
    (_key, value) => (typeof value === "bigint" ? { [BIGINT_KEY]: value.toString() } : value),
    2,
  )}\n`;
}

export function readFixture(json: string): AccountFixture {
  return JSON.parse(json, (_key, value) =>
    value !== null && typeof value === "object" && typeof value[BIGINT_KEY] === "string"
      ? BigInt(value[BIGINT_KEY])
      : value,
  ) as AccountFixture;
}
