import { randomBytes } from "node:crypto";
import type { PlaceResult } from "@perplog/chain/signer";
import type { Address, MarketInfo } from "@perplog/core";
import type { Hex } from "viem";
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

export type PlaceParams = Parameters<ChainPort["placeMarketFor"]>[1];

/**
 * What one `placeMarketFor` call does: fill the whole qty, fill part of it, throw, or run a function that may
 * await, mutate the fake, throw, and returns the filled qty. Unscripted sends fill completely.
 */
export type SendOutcome = "fill" | { fill: bigint } | Error | ((p: PlaceParams) => Promise<bigint>);

export interface SendRecord extends PlaceParams {
  privateKey: Hex;
  /** The live position size at the moment the order was sent. */
  sizeAtSend: bigint;
}

/**
 * An in-memory exchange for one account: a mutable position size and mark per pool, and a `placeMarketFor`
 * that applies its fill to the size (a bid adds, an ask subtracts). `calls` records every read and send in order.
 */
export function fakeTradingChain(markets: MarketInfo[]) {
  const sizes = new Map<Address, bigint | Error>();
  const marks = new Map<Address, { price: bigint; fromIndex: boolean } | Error>();
  const script: SendOutcome[] = [];
  const sends: SendRecord[] = [];
  const calls: string[] = [];
  let tx = 0;

  const sizeOf = (pool: Address): bigint => {
    const v = sizes.get(pool) ?? 0n;
    if (v instanceof Error) throw v;
    return v;
  };

  const chain = fakeChain({
    markets: vi.fn(async () => markets),
    readPositionSize: vi.fn(async (_account: Address, pool: Address) => {
      calls.push(`size:${pool}`);
      return sizeOf(pool);
    }),
    readMark: vi.fn(async (pool: Address) => {
      calls.push(`mark:${pool}`);
      const m = marks.get(pool);
      if (m === undefined) throw new Error(`no mark for ${pool}`);
      if (m instanceof Error) throw m;
      return m;
    }),
    placeMarketFor: vi.fn(async (privateKey: Hex, p: PlaceParams): Promise<PlaceResult> => {
      calls.push(`send:${p.pool}`);
      sends.push({ ...p, privateKey, sizeAtSend: sizeOf(p.pool) });
      const outcome = script.shift() ?? "fill";
      if (outcome instanceof Error) throw outcome;
      const filled =
        outcome === "fill" ? p.qtyRaw : typeof outcome === "function" ? await outcome(p) : outcome.fill;
      // Applied to the size as it is now: the scripted function may have moved it meanwhile.
      sizes.set(p.pool, sizeOf(p.pool) + (p.isBid ? filled : -filled));
      tx += 1;
      return {
        txHash: `0x${tx.toString(16).padStart(64, "0")}`,
        orderId: BigInt(tx),
        filledRaw: filled,
        avgPrice: filled > 0n ? 1n : null,
        gasUsed: 21_000n,
      };
    }),
  });

  return { chain, sizes, marks, script, sends, calls };
}
