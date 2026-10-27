import { type WatchHandle, watchPositionUpdates } from "@perplog/chain";
import type { AlertEngine, Timers } from "./alert-engine";
import type { Logger } from "./log";
import type { ChainPort } from "./ports";

const SUBSCRIBE_TIMEOUT_MS = 15_000;
const UNSUBSCRIBE_TIMEOUT_MS = 5_000;

type Subscription = Awaited<ReturnType<ChainPort["subscribePositionUpdates"]>>;

/**
 * Feeds MarginBank `PositionUpdated` events from Reactivity into the AlertEngine and tells it when the feed is
 * degraded. The watchdog awaits subscribe and unsubscribe, so both are bounded here: a hung subscribe counts as a
 * failure (and a late answer is unsubscribed), and a hung unsubscribe is abandoned so resubscribing goes on.
 */
export function startReactivityListener(
  chain: ChainPort,
  engine: AlertEngine,
  log: Logger,
  opts: { timers?: Timers; subscribeTimeoutMs?: number } = {},
): WatchHandle {
  const timers = opts.timers ?? { setTimeout, clearTimeout, now: Date.now };
  const subscribeTimeoutMs = opts.subscribeTimeoutMs ?? SUBSCRIBE_TIMEOUT_MS;

  const bounded = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = timers.setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
      p.then(
        (v) => {
          timers.clearTimeout(timer);
          resolve(v);
        },
        (err: unknown) => {
          timers.clearTimeout(timer);
          reject(err);
        },
      );
    });

  const wrap = (sub: Subscription): Subscription => ({
    unsubscribe: () =>
      bounded(sub.unsubscribe(), UNSUBSCRIBE_TIMEOUT_MS, "unsubscribe").catch((err: unknown) =>
        log.warn({ err }, "reactivity unsubscribe failed"),
      ),
  });

  return watchPositionUpdates({
    timers,
    subscribe: async (onData) => {
      let timedOut = false;
      const pending = chain.subscribePositionUpdates(onData);
      // A subscription that arrives after we gave up would leak: drop it. Its events are already ignored,
      // because the watchdog only listens to its newest attempt.
      void pending.then(
        (sub) => {
          if (timedOut) void wrap(sub).unsubscribe();
        },
        () => {},
      );
      try {
        return wrap(await bounded(pending, subscribeTimeoutMs, "subscribe"));
      } catch (err) {
        timedOut = true;
        log.warn({ err }, "reactivity subscribe failed");
        throw err;
      }
    },
    onUpdate: (u) => {
      // Runs inside the SDK's WebSocket callback: it must never throw.
      engine
        .onUpdate(u)
        .catch((err: unknown) =>
          log.warn({ err, ...u, newSize: u.newSize.toString() }, "position update handling failed"),
        );
    },
    onStatus: (s) => {
      if (s === "live") log.info("reactivity feed live");
      else log.warn("reactivity feed degraded");
      engine.setFeed(s);
    },
  });
}
