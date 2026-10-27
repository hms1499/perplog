import type { FeedStatus, PositionUpdate, watchPositionUpdates } from "@perplog/chain";
import {
  type Address,
  needsUnprotectedCheck,
  type Side,
  UNPROTECTED_GRACE_SEC,
  UNPROTECTED_POLL_SEC,
} from "@perplog/core";
import { type Db, insertAlert, listAccountStops, listWatchedAccounts, transitionStop } from "@perplog/db";
import type { Logger } from "./log";
import type { ChainPort } from "./ports";

export type Timers = NonNullable<Parameters<typeof watchPositionUpdates>[0]["timers"]>;

const UNPROTECTED_DEDUPE_SEC = 600;

type Timer = ReturnType<typeof setTimeout>;

const sideOf = (size: bigint): Side => (size > 0n ? "long" : "short");
const keyOf = (account: Address, pool: Address) => `${account}:${pool}`;

export interface AlertEngine {
  /** One position change, from Reactivity or from the degraded-feed poll. */
  onUpdate(u: PositionUpdate): Promise<void>;
  /** `degraded` starts the indexer poll, `live` stops it. */
  setFeed(s: FeedStatus): void;
  refreshWatched(): Promise<void>;
  /** Resolves when no scheduled check or poll is running (tests). */
  idle(): Promise<void>;
  stop(): void;
}

/**
 * Watches position changes for two things:
 * - an armed or paused stop whose position went to 0 or flipped is cancelled, once the live size confirms it
 *   (an event can be late or replayed; the chain is the truth). Triggered/executing stops belong to the StopEngine;
 * - a watched account that opens, grows or flips a position gets an `unprotected_position` alert when, 60 s later,
 *   the position is still open with no PerpLog stop and no native stop-loss on that side.
 *
 * Sizes are cached for watched accounts only. While Reactivity is degraded, the indexer is polled every 30 s and
 * its rows go through `onUpdate`, so an open position still alerts within 90 s.
 */
export function createAlertEngine(deps: {
  db: Db;
  chain: ChainPort;
  log: Logger;
  timers?: Timers;
}): AlertEngine {
  const { db, chain, log } = deps;
  const timers = deps.timers ?? { setTimeout, clearTimeout, now: Date.now };
  const sizes = new Map<string, bigint>();
  const checks = new Map<string, Timer>();
  const inFlight = new Set<Promise<void>>();
  let watched = new Set<Address>();
  let stopped = false;
  let pollTimer: Timer | null = null;
  let pollGeneration = 0;
  let polling = false;

  const track = (p: Promise<void>): void => {
    inFlight.add(p);
    void p.finally(() => inFlight.delete(p));
  };

  const cancelCheck = (key: string) => {
    const t = checks.get(key);
    if (t !== undefined) timers.clearTimeout(t);
    checks.delete(key);
  };

  async function autoCancel(u: PositionUpdate): Promise<void> {
    const candidates = (await listAccountStops(db, u.account, ["armed", "paused"])).filter(
      (s) => s.pool === u.pool && (u.newSize === 0n || sideOf(u.newSize) !== s.positionSide),
    );
    if (candidates.length === 0) return;
    let live: bigint;
    try {
      live = await chain.readPositionSize(u.account, u.pool);
    } catch (err) {
      log.warn({ err, account: u.account, pool: u.pool }, "auto-cancel skipped: size read failed");
      return;
    }
    for (const s of candidates) {
      if (live !== 0n && sideOf(live) === s.positionSide) continue;
      const reason = live === 0n ? "position_closed" : "position_flipped";
      if (await transitionStop(db, s.id, ["armed", "paused"], "cancelled", { lastError: reason })) {
        log.info({ stopId: s.id, account: u.account, pool: u.pool, reason }, "stop_auto_cancelled");
      }
    }
  }

  async function check(account: Address, pool: Address): Promise<void> {
    const key = keyOf(account, pool);
    checks.delete(key);
    const size = sizes.get(key);
    if (stopped || !watched.has(account) || size === undefined || size === 0n) return;
    const side = sideOf(size);
    try {
      const covered = (await listAccountStops(db, account, ["armed", "triggered", "executing"])).some(
        (s) => s.pool === pool && s.positionSide === side,
      );
      if (covered) return;
      if ((await chain.pendingStopLosses(account, pool, side)) > 0) return;
      const symbol = (await chain.markets()).find((m) => m.pool.toLowerCase() === pool)?.symbol ?? null;
      const inserted = await insertAlert(db, {
        account,
        type: "unprotected_position",
        pool,
        payload: { symbol, side, sizeRaw: size.toString() },
        dedupeWithinSec: UNPROTECTED_DEDUPE_SEC,
      });
      if (inserted) log.info({ account, pool, side, sizeRaw: size.toString() }, "unprotected_position");
    } catch (err) {
      log.warn({ err, account, pool }, "unprotected check failed");
    }
  }

  async function onUpdate(raw: PositionUpdate): Promise<void> {
    if (stopped) return;
    const u = {
      account: raw.account.toLowerCase() as Address,
      pool: raw.pool.toLowerCase() as Address,
      newSize: raw.newSize,
    };
    const key = keyOf(u.account, u.pool);
    const isWatched = watched.has(u.account);
    const prev = sizes.get(key);
    if (isWatched) {
      if (u.newSize === 0n) {
        sizes.delete(key);
        cancelCheck(key);
      } else {
        sizes.set(key, u.newSize);
      }
    }

    await autoCancel(u);

    if (isWatched && !stopped && needsUnprotectedCheck(prev, u.newSize)) {
      cancelCheck(key);
      checks.set(
        key,
        timers.setTimeout(() => track(check(u.account, u.pool)), UNPROTECTED_GRACE_SEC * 1000),
      );
    }
  }

  async function pollOnce(): Promise<void> {
    const accounts = [...watched];
    if (accounts.length === 0) return;
    const rows = await chain.openPositions(accounts);
    const seen = new Set<string>();
    for (const r of rows) {
      seen.add(keyOf(r.account.toLowerCase() as Address, r.pool.toLowerCase() as Address));
      await onUpdate({ account: r.account, pool: r.pool, newSize: r.size });
    }
    // A cached open position the indexer no longer lists was closed while the feed was down.
    for (const [key, size] of [...sizes]) {
      if (size === 0n || seen.has(key)) continue;
      const [account, pool] = key.split(":") as [Address, Address];
      await onUpdate({ account, pool, newSize: 0n });
    }
  }

  async function poll(generation: number): Promise<void> {
    pollTimer = null;
    if (stopped || !polling || generation !== pollGeneration) return;
    try {
      await pollOnce();
    } catch (err) {
      log.warn({ err }, "degraded poll failed");
    }
    if (stopped || !polling || generation !== pollGeneration) return;
    pollTimer = timers.setTimeout(() => track(poll(generation)), UNPROTECTED_POLL_SEC * 1000);
  }

  const stopPolling = () => {
    polling = false;
    pollGeneration += 1;
    if (pollTimer !== null) timers.clearTimeout(pollTimer);
    pollTimer = null;
  };

  return {
    onUpdate,
    setFeed(s) {
      if (stopped) return;
      if (s === "live") {
        if (polling) log.info("reactivity live again, poll stopped");
        stopPolling();
        return;
      }
      if (polling) return;
      polling = true;
      pollGeneration += 1;
      log.warn({ everySec: UNPROTECTED_POLL_SEC }, "reactivity degraded, polling open positions");
      track(poll(pollGeneration));
    },
    async refreshWatched() {
      const next = new Set((await listWatchedAccounts(db)).map((a) => a.toLowerCase() as Address));
      watched = next;
      for (const key of [...sizes.keys()]) {
        if (next.has(key.split(":")[0] as Address)) continue;
        sizes.delete(key);
        cancelCheck(key);
      }
    },
    async idle() {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    },
    stop() {
      stopped = true;
      stopPolling();
      for (const key of [...checks.keys()]) cancelCheck(key);
    },
  };
}
