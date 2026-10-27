import type { Address } from "@perplog/core";
import { marginBankEventsAbi, type SomniaMarketsClient } from "@somnia-chain/markets-sdk";
import { createReactivity, unwrap } from "@somnia-chain/markets-sdk/reactivity";
import { decodeEventLog, type Hex, toEventSelector } from "viem";

export interface PositionUpdate {
  account: Address;
  pool: Address;
  newSize: bigint;
}

const POSITION_UPDATED_EVENT = marginBankEventsAbi.find(
  (e) => e.type === "event" && e.name === "PositionUpdated",
);
if (!POSITION_UPDATED_EVENT) throw new Error("marginBankEventsAbi has no PositionUpdated event");

/** topic0 of MarginBank `PositionUpdated(account indexed, perpPool indexed, newSize, ...)`. */
export const POSITION_UPDATED_TOPIC: Hex = toEventSelector(POSITION_UPDATED_EVENT);

/** Decode a MarginBank log; null when it is not a well-formed `PositionUpdated`. */
export function decodePositionUpdated(e: { topics: Hex[]; data: Hex }): PositionUpdate | null {
  if (e.topics[0] !== POSITION_UPDATED_TOPIC) return null;
  try {
    const decoded = decodeEventLog({
      abi: [POSITION_UPDATED_EVENT],
      topics: e.topics as [Hex, ...Hex[]],
      data: e.data,
    });
    const args = decoded.args as unknown as { account: Address; perpPool: Address; newSize: bigint };
    return {
      account: args.account.toLowerCase() as Address,
      pool: args.perpPool.toLowerCase() as Address,
      newSize: args.newSize,
    };
  } catch {
    return null;
  }
}

export type FeedStatus = "live" | "degraded";

export interface WatchHandle {
  stop(): Promise<void>;
}

type RawEvent = { topics: Hex[]; data: Hex };
type Subscribe = (onData: (e: RawEvent) => void) => Promise<{ unsubscribe(): Promise<unknown> }>;

const SILENCE_MS = 60_000;
const BACKOFF = { min: 1_000, max: 30_000 };

/**
 * Keeps one Reactivity subscription alive. A WebSocket can stay open while the
 * node stops delivering, so `silenceMs` without any event counts as dead:
 * report `degraded`, drop the subscription and resubscribe with exponential
 * backoff (min, 2x, ... max). The feed is `live` after the first subscribe and,
 * after a drop, again on the first event of the new subscription.
 */
export function watchPositionUpdates(args: {
  subscribe: Subscribe;
  onUpdate: (u: PositionUpdate) => void;
  onStatus: (s: FeedStatus) => void;
  silenceMs?: number;
  backoffMs?: { min: number; max: number };
  timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout; now: () => number };
}): WatchHandle {
  const silenceMs = args.silenceMs ?? SILENCE_MS;
  const backoff = args.backoffMs ?? BACKOFF;
  const timers = args.timers ?? { setTimeout, clearTimeout, now: Date.now };

  let stopped = false;
  let generation = 0;
  let current: { unsubscribe(): Promise<unknown> } | null = null;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let nextDelay = backoff.min;
  let status: FeedStatus | null = null;

  const setStatus = (s: FeedStatus) => {
    if (status === s) return;
    status = s;
    args.onStatus(s);
  };
  const clearSilence = () => {
    if (silenceTimer !== null) timers.clearTimeout(silenceTimer);
    silenceTimer = null;
  };
  const armSilence = () => {
    clearSilence();
    silenceTimer = timers.setTimeout(onSilence, silenceMs);
  };
  const dropCurrent = async () => {
    const sub = current;
    current = null;
    generation++;
    if (sub) await sub.unsubscribe().catch(() => {});
  };
  const scheduleRetry = () => {
    if (stopped) return;
    const delay = nextDelay;
    nextDelay = Math.min(nextDelay * 2, backoff.max);
    retryTimer = timers.setTimeout(() => {
      retryTimer = null;
      void attempt();
    }, delay);
  };
  function onSilence(): void {
    silenceTimer = null;
    if (stopped) return;
    setStatus("degraded");
    void dropCurrent().then(scheduleRetry);
  }
  async function attempt(): Promise<void> {
    if (stopped) return;
    const mine = ++generation;
    const onData = (e: RawEvent) => {
      if (stopped || mine !== generation) return;
      nextDelay = backoff.min;
      armSilence();
      setStatus("live");
      const update = decodePositionUpdated(e);
      if (update) args.onUpdate(update);
    };
    try {
      const sub = await args.subscribe(onData);
      if (stopped || mine !== generation) {
        await sub.unsubscribe().catch(() => {});
        return;
      }
      current = sub;
      armSilence();
      if (status === null) setStatus("live");
    } catch {
      if (stopped || mine !== generation) return;
      setStatus("degraded");
      scheduleRetry();
    }
  }

  void attempt();

  return {
    async stop() {
      stopped = true;
      clearSilence();
      if (retryTimer !== null) timers.clearTimeout(retryTimer);
      retryTimer = null;
      await dropCurrent();
    },
  };
}

/** Subscribe to MarginBank `PositionUpdated` over the SDK client's WebSocket (Somnia Reactivity). */
export function reactivitySubscriber(client: SomniaMarketsClient, marginBank: Address): Subscribe {
  return async (onData) => {
    const watch = unwrap(
      await createReactivity(client).watch({
        eventContractSources: [marginBank],
        topicOverrides: [POSITION_UPDATED_TOPIC],
        ethCalls: [],
        // viem unwraps the JSON-RPC envelope: the log is `n.result`, not `n.params.result`.
        onData: (n: { result: RawEvent }) => onData(n.result),
      }),
    );
    return { unsubscribe: () => watch.unsubscribe() };
  };
}
