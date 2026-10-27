import { type FeedStatus, POSITION_UPDATED_TOPIC, type PositionUpdate } from "@perplog/chain";
import type { Address } from "@perplog/core";
import { encodeAbiParameters, type Hex, pad } from "viem";
import type { AlertEngine } from "../src/alert-engine";
import { startReactivityListener } from "../src/reactivity-listener";
import { fakeChain, fakeLogger, manualTimers } from "./fakes";

const ACCOUNT = `0x${"a1".repeat(20)}` as Address;
const POOL = `0x${"b1".repeat(20)}` as Address;

type OnData = (e: { topics: Hex[]; data: Hex }) => void;

const flush = () => new Promise<void>((r) => setImmediate(r));

function fakeEngine(onUpdate: (u: PositionUpdate) => Promise<void> = async () => {}) {
  const feed: FeedStatus[] = [];
  const engine: AlertEngine = {
    onUpdate: vi.fn(onUpdate),
    setFeed: (s) => feed.push(s),
    refreshWatched: async () => {},
    idle: async () => {},
    stop: () => {},
  };
  return { engine, feed };
}

/** A PositionUpdated log; the three static fields after newSize (uint128, int256, int256) are zero. */
const positionUpdated = (newSize: bigint): { topics: Hex[]; data: Hex } => ({
  topics: [POSITION_UPDATED_TOPIC, pad(ACCOUNT), pad(POOL)],
  data: `${encodeAbiParameters([{ type: "int256" }], [newSize])}${"0".repeat(64 * 3)}` as Hex,
});

test("updates reach the engine and feed status is forwarded", async () => {
  const subs: OnData[] = [];
  const chain = fakeChain({
    subscribePositionUpdates: vi.fn(async (onData: OnData) => {
      subs.push(onData);
      return { unsubscribe: async () => {} };
    }),
  });
  const { engine, feed } = fakeEngine();
  const clock = manualTimers();
  const handle = startReactivityListener(chain, engine, fakeLogger(), { timers: clock.timers });
  await clock.advance(0, flush);
  expect(feed).toEqual(["live"]);
  subs[0]?.(positionUpdated(7n));
  expect(engine.onUpdate).toHaveBeenCalledWith({ account: ACCOUNT, pool: POOL, newSize: 7n });
  await handle.stop();
});

test("an engine failure is logged and never thrown into the socket callback", async () => {
  const subs: OnData[] = [];
  const chain = fakeChain({
    subscribePositionUpdates: vi.fn(async (onData: OnData) => {
      subs.push(onData);
      return { unsubscribe: async () => {} };
    }),
  });
  const { engine } = fakeEngine(async () => {
    throw new Error("db down");
  });
  const log = fakeLogger();
  const clock = manualTimers();
  const handle = startReactivityListener(chain, engine, log, { timers: clock.timers });
  await clock.advance(0, flush);
  expect(() => subs[0]?.(positionUpdated(1n))).not.toThrow();
  await flush();
  expect(log.has("position update handling failed")).toBe(true);
  await handle.stop();
});

test("a subscribe that never answers is abandoned, reported degraded and retried", async () => {
  let calls = 0;
  const chain = fakeChain({
    subscribePositionUpdates: vi.fn(() => {
      calls += 1;
      // The first attempt hangs forever; the retry answers.
      return calls === 1 ? new Promise<never>(() => {}) : Promise.resolve({ unsubscribe: async () => {} });
    }),
  });
  const { engine, feed } = fakeEngine();
  const clock = manualTimers();
  const handle = startReactivityListener(chain, engine, fakeLogger(), {
    timers: clock.timers,
    subscribeTimeoutMs: 15_000,
  });
  await clock.advance(20_000, flush);
  // Live again only once the new subscription delivers an event (watchdog rule).
  expect(feed).toEqual(["degraded"]);
  expect(calls).toBe(2);
  await handle.stop();
});

test("a hung unsubscribe does not block the resubscribe after silence", async () => {
  let calls = 0;
  const chain = fakeChain({
    subscribePositionUpdates: vi.fn(async () => {
      calls += 1;
      return { unsubscribe: () => new Promise<never>(() => {}) };
    }),
  });
  const { engine, feed } = fakeEngine();
  const clock = manualTimers();
  const handle = startReactivityListener(chain, engine, fakeLogger(), {
    timers: clock.timers,
    subscribeTimeoutMs: 15_000,
  });
  // 60 s of silence drops the subscription; the unsubscribe hangs; the retry still happens.
  await clock.advance(90_000, flush);
  expect(feed[0]).toBe("live");
  expect(feed).toContain("degraded");
  expect(calls).toBeGreaterThanOrEqual(2);
  void handle.stop();
});
