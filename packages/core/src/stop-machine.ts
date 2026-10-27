import { CLOSE_SLIP_MAX_BPS, CLOSE_SLIP_START_BPS, CLOSE_SLIP_STEP_BPS } from "./config";
import type { Side } from "./types";

export type StopStatus = "armed" | "paused" | "triggered" | "executing" | "done" | "failed" | "cancelled";

export type StopEvent =
  | "trigger"
  | "execute"
  | "filled"
  | "give_up"
  | "position_closed"
  | "position_flipped"
  | "grant_lost"
  | "grant_back"
  | "user_cancel";

export const ACTIVE_STOP_STATUSES: readonly StopStatus[] = ["armed", "paused", "triggered", "executing"];

const TRANSITIONS: Record<StopStatus, Partial<Record<StopEvent, StopStatus>>> = {
  armed: {
    trigger: "triggered",
    position_closed: "cancelled",
    position_flipped: "cancelled",
    grant_lost: "paused",
    user_cancel: "cancelled",
  },
  paused: {
    grant_back: "armed",
    position_closed: "cancelled",
    position_flipped: "cancelled",
    user_cancel: "cancelled",
  },
  triggered: {
    execute: "executing",
    position_closed: "done",
    position_flipped: "cancelled",
    filled: "done",
  },
  executing: {
    execute: "executing",
    filled: "done",
    position_closed: "done",
    position_flipped: "cancelled",
    give_up: "failed",
  },
  done: {},
  failed: {},
  cancelled: {},
};

/** The next status for an event, or null when the event is not allowed in this status. */
export function nextStopStatus(status: StopStatus, event: StopEvent): StopStatus | null {
  return TRANSITIONS[status][event] ?? null;
}

/** A long stop fires when the mark falls to the trigger, a short stop when it rises to it. */
export function isTriggered(side: Side, triggerPrice: bigint, mark: bigint): boolean {
  return side === "long" ? mark <= triggerPrice : mark >= triggerPrice;
}

/** Slippage allowed on close attempt `attempt` (0-based): grows each retry, capped. */
export function closeSlipBps(attempt: number, maxSlipBps: number = CLOSE_SLIP_MAX_BPS): number {
  return Math.min(CLOSE_SLIP_START_BPS + CLOSE_SLIP_STEP_BPS * attempt, maxSlipBps);
}
