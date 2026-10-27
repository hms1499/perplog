import type { Address } from "@perplog/core";
import { marginBankEventsAbi } from "@somnia-chain/markets-sdk";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import {
  decodePositionUpdated,
  type FeedStatus,
  POSITION_UPDATED_TOPIC,
  watchPositionUpdates,
} from "../src/reactivity";

const ACCOUNT = `0x${"aa".repeat(20)}` as Address;
const POOL = `0x${"e1".repeat(20)}` as Address;

function positionUpdatedLog(newSize: bigint): { topics: Hex[]; data: Hex } {
  const topics = encodeEventTopics({
    abi: marginBankEventsAbi,
    eventName: "PositionUpdated",
    args: { account: ACCOUNT, perpPool: POOL },
  }) as Hex[];
  const event = marginBankEventsAbi.find((e) => e.type === "event" && e.name === "PositionUpdated");
  if (!event) throw new Error("PositionUpdated missing from ABI");
  const data = encodeAbiParameters(
    event.inputs.filter((i) => !i.indexed),
    event.inputs.filter((i) => !i.indexed).map((i) => (i.name === "newSize" ? newSize : 1n)),
  );
  return { topics, data };
}

test("decodes a PositionUpdated log and ignores other topics", () => {
  expect(decodePositionUpdated(positionUpdatedLog(-5n))).toEqual({
    account: ACCOUNT,
    pool: POOL,
    newSize: -5n,
  });
  expect(decodePositionUpdated({ topics: ["0xdead"], data: "0x" })).toBeNull();
  expect(decodePositionUpdated({ topics: [], data: "0x" })).toBeNull();
  expect(POSITION_UPDATED_TOPIC).toBe(positionUpdatedLog(1n).topics[0]);
});

/** A hand-driven clock: setTimeout only fires through advance(). */
function fakeClock() {
  let nowMs = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers = {
    setTimeout: ((fn: () => void, ms = 0) => {
      const id = nextId++;
      pending.set(id, { at: nowMs + ms, fn });
      return id;
    }) as unknown as typeof setTimeout,
    clearTimeout: ((id: number) => {
      pending.delete(id);
    }) as unknown as typeof clearTimeout,
    now: () => nowMs,
  };
  async function advance(ms: number): Promise<void> {
    const end = nowMs + ms;
    for (;;) {
      const due = [...pending.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      pending.delete(due[0]);
      nowMs = due[1].at;
      due[1].fn();
      await flush();
    }
    nowMs = end;
  }
  return { timers, advance };
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

test("watchdog: 60s of silence -> degraded, resubscribes with backoff, first event -> live", async () => {
  const clock = fakeClock();
  const statuses: FeedStatus[] = [];
  const updates: unknown[] = [];
  const handlers: ((e: { topics: Hex[]; data: Hex }) => void)[] = [];
  const unsubscribed: number[] = [];
  const subscribe = vi.fn(async (onData: (e: { topics: Hex[]; data: Hex }) => void) => {
    const n = handlers.push(onData);
    return {
      unsubscribe: async () => {
        unsubscribed.push(n);
      },
    };
  });

  const handle = watchPositionUpdates({
    subscribe,
    onUpdate: (u) => updates.push(u),
    onStatus: (s) => statuses.push(s),
    timers: clock.timers,
  });
  await flush();
  expect(subscribe).toHaveBeenCalledTimes(1);
  expect(statuses).toEqual(["live"]);

  await clock.advance(59_999);
  expect(statuses).toEqual(["live"]);
  await clock.advance(1);
  expect(statuses).toEqual(["live", "degraded"]);
  expect(unsubscribed).toEqual([1]);
  expect(subscribe).toHaveBeenCalledTimes(1);

  await clock.advance(1_000);
  expect(subscribe).toHaveBeenCalledTimes(2);
  // Degraded until an event arrives, not merely until subscribe resolves.
  expect(statuses).toEqual(["live", "degraded"]);

  handlers[1]?.(positionUpdatedLog(7n));
  expect(updates).toEqual([{ account: ACCOUNT, pool: POOL, newSize: 7n }]);
  expect(statuses).toEqual(["live", "degraded", "live"]);

  // An event resets the silence timer.
  await clock.advance(59_000);
  handlers[1]?.(positionUpdatedLog(8n));
  await clock.advance(59_000);
  expect(statuses.at(-1)).toBe("live");

  await handle.stop();
  await clock.advance(200_000);
  expect(subscribe).toHaveBeenCalledTimes(2);
});

test("a rejected subscribe retries after 1s, 2s, 4s ... capped at 30s", async () => {
  const clock = fakeClock();
  const statuses: FeedStatus[] = [];
  const attempts: number[] = [];
  const subscribe = vi.fn(async () => {
    attempts.push(clock.timers.now());
    throw new Error("ws down");
  });
  const handle = watchPositionUpdates({
    subscribe,
    onUpdate: () => {},
    onStatus: (s) => statuses.push(s),
    timers: clock.timers,
  });
  await flush();
  expect(statuses).toEqual(["degraded"]);
  await clock.advance(200_000);
  const gaps = attempts.slice(1).map((t, i) => t - (attempts[i] ?? 0));
  expect(gaps.slice(0, 7)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
  await handle.stop();
});

test("a successful event resets the backoff", async () => {
  const clock = fakeClock();
  const attempts: number[] = [];
  const handlers: ((e: { topics: Hex[]; data: Hex }) => void)[] = [];
  let fail = true;
  const subscribe = vi.fn(async (onData: (e: { topics: Hex[]; data: Hex }) => void) => {
    attempts.push(clock.timers.now());
    if (fail) throw new Error("ws down");
    handlers.push(onData);
    return { unsubscribe: async () => {} };
  });
  const handle = watchPositionUpdates({
    subscribe,
    onUpdate: () => {},
    onStatus: () => {},
    timers: clock.timers,
  });
  await flush();
  await clock.advance(1_000); // attempt 2 (fails)
  await clock.advance(2_000); // attempt 3 (fails)
  fail = false;
  await clock.advance(4_000); // attempt 4 (ok)
  expect(handlers).toHaveLength(1);
  handlers[0]?.(positionUpdatedLog(1n));
  await clock.advance(60_000); // silence -> degraded -> resubscribe after the minimum again
  const before = attempts.length;
  await clock.advance(1_000);
  expect(attempts.length).toBe(before + 1);
  await handle.stop();
});
