import { randomBytes } from "node:crypto";
import { vi } from "vitest";
import type { WorkerEnv } from "../src/env";
import type { Logger } from "../src/log";
import type { ChainPort } from "../src/ports";

export interface LogEntry {
  level: "info" | "warn" | "error";
  msg: string;
  obj: Record<string, unknown>;
}

/** Records every log call; accepts both `(msg)` and `(obj, msg)` like pino. */
export function fakeLogger(): Logger & { entries: LogEntry[]; has(msg: string): boolean } {
  const entries: LogEntry[] = [];
  const at =
    (level: LogEntry["level"]) =>
    (a: object | string, b?: string): void => {
      entries.push(
        typeof a === "string"
          ? { level, msg: a, obj: {} }
          : { level, msg: b ?? "", obj: a as Record<string, unknown> },
      );
    };
  return {
    entries,
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
    has: (msg) => entries.some((e) => e.msg === msg),
  };
}

export const b64 = (n: number): string => randomBytes(n).toString("base64");

export function fakeEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    DATABASE_URL: "postgres://unused",
    KEY_ENCRYPTION_KEY: randomBytes(32),
    TREASURY_PRIVATE_KEY: null,
    NETWORK: "hideki",
    GAS_TOPUP_THRESHOLD_WEI: 2n * 10n ** 17n,
    GAS_TOPUP_AMOUNT_WEI: 5n * 10n ** 17n,
    GAS_TOPUP_DAILY_CAP_WEI: 2n * 10n ** 18n,
    LOG_LEVEL: "silent",
    ...overrides,
  };
}

/** A ChainPort whose every method fails loudly: tests override only what they exercise. */
export function fakeChain(overrides: Partial<ChainPort> = {}): ChainPort {
  const unused = (name: string) =>
    vi.fn(async () => Promise.reject(new Error(`ChainPort.${name} not faked`)));
  return {
    markets: unused("markets"),
    readPositionSize: unused("readPositionSize"),
    readMark: unused("readMark"),
    grantedPools: unused("grantedPools"),
    placeMarketFor: unused("placeMarketFor"),
    balanceOf: unused("balanceOf"),
    sendNative: unused("sendNative"),
    pendingStopLosses: unused("pendingStopLosses"),
    openPositions: unused("openPositions"),
    subscribePositionUpdates: unused("subscribePositionUpdates"),
    ...overrides,
  } as ChainPort;
}
