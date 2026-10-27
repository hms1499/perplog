import {
  ACTIVE_STOP_STATUSES,
  closeSlipBps,
  isTriggered,
  nextStopStatus,
  type StopEvent,
  type StopStatus,
} from "../src/stop-machine";

const STATUSES: StopStatus[] = ["armed", "paused", "triggered", "executing", "done", "failed", "cancelled"];
const EVENTS: StopEvent[] = [
  "trigger",
  "execute",
  "filled",
  "give_up",
  "position_closed",
  "position_flipped",
  "grant_lost",
  "grant_back",
  "user_cancel",
];

const ALLOWED: [StopStatus, StopEvent, StopStatus][] = [
  ["armed", "trigger", "triggered"],
  ["armed", "position_closed", "cancelled"],
  ["armed", "position_flipped", "cancelled"],
  ["armed", "grant_lost", "paused"],
  ["armed", "user_cancel", "cancelled"],
  ["paused", "grant_back", "armed"],
  ["paused", "position_closed", "cancelled"],
  ["paused", "position_flipped", "cancelled"],
  ["paused", "user_cancel", "cancelled"],
  ["triggered", "execute", "executing"],
  ["triggered", "position_closed", "done"],
  ["triggered", "position_flipped", "cancelled"],
  ["triggered", "filled", "done"],
  ["executing", "execute", "executing"],
  ["executing", "filled", "done"],
  ["executing", "position_closed", "done"],
  ["executing", "position_flipped", "cancelled"],
  ["executing", "give_up", "failed"],
];

test.each(ALLOWED)("%s + %s -> %s", (from, event, to) => {
  expect(nextStopStatus(from, event)).toBe(to);
});

test("every pair not in the table is rejected", () => {
  const allowed = new Set(ALLOWED.map(([from, event]) => `${from}:${event}`));
  let rejected = 0;
  for (const status of STATUSES) {
    for (const event of EVENTS) {
      if (allowed.has(`${status}:${event}`)) continue;
      expect(nextStopStatus(status, event), `${status} + ${event}`).toBeNull();
      rejected += 1;
    }
  }
  expect(rejected).toBe(STATUSES.length * EVENTS.length - ALLOWED.length);
});

test("active statuses are the non-terminal ones", () => {
  expect(ACTIVE_STOP_STATUSES).toEqual(["armed", "paused", "triggered", "executing"]);
});

test("trigger rule: long fires at or below, short at or above", () => {
  expect(isTriggered("long", 100n, 100n)).toBe(true);
  expect(isTriggered("long", 100n, 101n)).toBe(false);
  expect(isTriggered("short", 100n, 100n)).toBe(true);
  expect(isTriggered("short", 100n, 99n)).toBe(false);
});

test("close slippage grows per attempt and is capped", () => {
  expect([0, 1, 2, 3, 4, 9].map((a) => closeSlipBps(a))).toEqual([150, 250, 350, 450, 500, 500]);
  expect(closeSlipBps(3, 300)).toBe(300);
});
