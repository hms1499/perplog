import { randomBytes } from "node:crypto";
import { type PlaceResult, type ReceiptResult, TxOutcomeUnknown } from "@perplog/chain/signer";
import type { Address, MarketInfo } from "@perplog/core";
import type { Hash, Hex } from "viem";
import { onTestFinished, vi } from "vitest";
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
    blockNumber: unused("blockNumber"),
    receiptOf: unused("receiptOf"),
    hasPendingTx: unused("hasPendingTx"),
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
 * What one `placeMarketFor` call does:
 * - `"fill"` / `{ fill }`: mined at once, filling all or part of the qty;
 * - an `Error`: thrown before broadcast (nothing sent);
 * - a function: may await, mutate the fake or throw, and returns the filled qty;
 * - `{ unknown: fill }`: broadcast, then the receipt wait fails (`TxOutcomeUnknown`, with the hash unless
 *   `withHash: false`). The tx stays pending until `mine()` applies `fill` and makes its receipt visible, or
 *   `drop()` discards it.
 * Unscripted sends fill completely.
 */
export type SendOutcome =
  | "fill"
  | { fill: bigint }
  | Error
  | ((p: PlaceParams) => Promise<bigint>)
  | { unknown: bigint; withHash?: boolean };

export interface SendRecord extends PlaceParams {
  privateKey: Hex;
  /** The live position size at the moment the order was sent. */
  sizeAtSend: bigint;
}

/**
 * An in-memory exchange for one account: a mutable position size and mark per pool, and a `placeMarketFor`
 * that applies its fill to the size (a bid adds, an ask subtracts). `calls` records every read and send in order.
 *
 * Every send is checked against the safety invariants: no other tx from the key may be pending, and the order
 * must be on the closing side and at most the live size. A violation fails the current test.
 */
export function fakeTradingChain(markets: MarketInfo[]) {
  const sizes = new Map<Address, bigint | Error>();
  const marks = new Map<Address, { price: bigint; fromIndex: boolean } | Error>();
  const script: SendOutcome[] = [];
  const sends: SendRecord[] = [];
  const calls: string[] = [];
  const violations: string[] = [];
  const receipts = new Map<Hash, ReceiptResult>();
  const pending: Array<{ hash: Hash; p: PlaceParams; fill: bigint }> = [];
  /**
   * - `externalPending`: a pending tx from the bot that the engine has no record of (e.g. sent before a crash);
   * - `chainBlock`: the real head; every mined tx lands in a new block;
   * - `lag`: how many blocks the node serving `blockNumber`/`readPositionSize` is behind the head. Receipts are
   *   visible at once (another backend), so a lagging size view answers with the size from before the fill;
   * - `blockError`: makes `blockNumber()` throw.
   */
  const state = { externalPending: false, chainBlock: 100n, lag: 0n, blockError: null as Error | null };
  /** Size before each mined fill, so a read pinned to an older block sees the older size. */
  const history: Array<{ block: bigint; pool: Address; before: bigint }> = [];
  let tx = 0;

  onTestFinished(() => {
    if (violations.length > 0) throw new Error(`unsafe sends:\n${violations.join("\n")}`);
  });

  const sizeOf = (pool: Address): bigint => {
    const v = sizes.get(pool) ?? 0n;
    if (v instanceof Error) throw v;
    return v;
  };
  const viewBlock = () => state.chainBlock - state.lag;
  const sizeAt = (pool: Address, block: bigint): bigint => {
    const current = sizeOf(pool);
    const later = history.find((h) => h.pool === pool && h.block > block);
    return later ? later.before : current;
  };
  const nextHash = (): Hash => {
    tx += 1;
    return `0x${tx.toString(16).padStart(64, "0")}`;
  };
  const apply = (p: PlaceParams, filled: bigint, hash: Hash): ReceiptResult => {
    // Applied to the size as it is now: a scripted function or a pending period may have moved it meanwhile.
    const before = sizeOf(p.pool);
    state.chainBlock += 1n;
    history.push({ block: state.chainBlock, pool: p.pool, before });
    sizes.set(p.pool, before + (p.isBid ? filled : -filled));
    const r = {
      txHash: hash,
      orderId: BigInt(tx),
      filledRaw: filled,
      avgPrice: filled > 0n ? 1n : null,
      gasUsed: 21_000n,
      blockNumber: state.chainBlock,
      reverted: false,
    };
    receipts.set(hash, r);
    return r;
  };

  const chain = fakeChain({
    markets: vi.fn(async () => markets),
    readPositionSize: vi.fn(async (_account: Address, pool: Address, atBlock?: bigint) => {
      calls.push(`size:${pool}`);
      const block = atBlock ?? viewBlock();
      if (block > viewBlock()) throw new Error(`header not found: block ${block}`);
      return sizeAt(pool, block);
    }),
    blockNumber: vi.fn(async () => {
      calls.push("block");
      if (state.blockError) throw state.blockError;
      return viewBlock();
    }),
    readMark: vi.fn(async (pool: Address) => {
      calls.push(`mark:${pool}`);
      const m = marks.get(pool);
      if (m === undefined) throw new Error(`no mark for ${pool}`);
      if (m instanceof Error) throw m;
      return m;
    }),
    hasPendingTx: vi.fn(async () => {
      calls.push("pending");
      return pending.length > 0 || state.externalPending;
    }),
    receiptOf: vi.fn(async (hash: Hash) => {
      calls.push(`receipt:${hash}`);
      return receipts.get(hash) ?? null;
    }),
    placeMarketFor: vi.fn(async (privateKey: Hex, p: PlaceParams): Promise<PlaceResult> => {
      calls.push(`send:${p.pool}`);
      const size = sizeOf(p.pool);
      sends.push({ ...p, privateKey, sizeAtSend: size });
      const abs = size < 0n ? -size : size;
      const problems = [
        pending.length > 0 || state.externalPending ? "another tx from this key is still pending" : null,
        p.qtyRaw <= 0n ? `qty ${p.qtyRaw} is not positive` : null,
        p.qtyRaw > abs ? `qty ${p.qtyRaw} exceeds the live size ${size}` : null,
        size !== 0n && p.isBid !== size < 0n ? `isBid=${p.isBid} opens on a size of ${size}` : null,
      ].filter((x): x is string => x !== null);
      if (problems.length > 0) {
        violations.push(`send #${sends.length} on ${p.pool}: ${problems.join("; ")}`);
        throw new Error(`INVARIANT VIOLATED: ${problems.join("; ")}`);
      }

      const outcome = script.shift() ?? "fill";
      if (outcome instanceof Error) throw outcome;
      if (typeof outcome === "object" && "unknown" in outcome) {
        const hash = nextHash();
        pending.push({ hash, p, fill: outcome.unknown });
        throw new TxOutcomeUnknown(
          outcome.withHash === false ? null : hash,
          new Error("HTTP request failed: 429"),
        );
      }
      const filled =
        outcome === "fill" ? p.qtyRaw : typeof outcome === "function" ? await outcome(p) : outcome.fill;
      const { reverted: _reverted, ...placed } = apply(p, filled, nextHash());
      return placed;
    }),
  });

  return {
    chain,
    sizes,
    marks,
    script,
    sends,
    calls,
    state,
    /** Mines every pending tx: its fill lands on the size and its receipt becomes visible. */
    mine() {
      for (const t of pending.splice(0)) apply(t.p, t.fill, t.hash);
    },
    /** A new empty block on the head. */
    advance() {
      state.chainBlock += 1n;
    },
    /** Drops every pending tx: nothing fills and no receipt ever appears. */
    drop() {
      pending.splice(0);
    },
  };
}
