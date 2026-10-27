import {
  OperatorRevert,
  type PlaceResult,
  type ReceiptResult,
  TxOutcomeUnknown,
} from "@perplog/chain/signer";
import {
  type Address,
  closePriceBound,
  closeSlipBps,
  isTriggered,
  type MarketInfo,
  nextStopStatus,
  planClose,
  STOP_GIVE_UP_MS,
  STOP_MAX_ATTEMPTS,
  type StopEvent,
  type StopStatus,
} from "@perplog/core";
import {
  type Db,
  type ExecutionRow,
  getBotKey,
  getStop,
  insertAlert,
  listStopExecutions,
  listStops,
  recordExecution,
  type StopRow,
  transitionStop,
  updateExecution,
} from "@perplog/db";
import { decryptPrivateKey } from "@perplog/db/crypto";
import type { Hash, Hex } from "viem";
import type { Logger } from "./log";
import type { ChainPort } from "./ports";
import { KeyedSerial } from "./serial";

export interface StopEngineDeps {
  db: Db;
  chain: ChainPort;
  kek: Buffer;
  log: Logger;
  now?: () => number;
}

export interface StopEngine {
  /** One polling pass: trigger armed stops whose mark crossed, and (re)schedule every in-progress stop. */
  tick(): Promise<void>;
  /** Resolves when no execution is queued or in flight. */
  idle(): Promise<void>;
  /** No new tick, execution or send after this; resolves once in-flight work has wound down. */
  stop(): Promise<void>;
}

const IN_PROGRESS: StopStatus[] = ["triggered", "executing"];

const lower = (a: string): Address => a.toLowerCase() as Address;

/** A short, key-free description of an error for `last_error` and logs. */
function errorText(err: unknown): string {
  if (err instanceof OperatorRevert) return err.errorName;
  const text =
    err instanceof Error
      ? ((err as Error & { shortMessage?: string }).shortMessage ?? err.message)
      : String(err);
  return text.slice(0, 200);
}

/**
 * Polls marks for pools with armed stops and closes positions for stops that trigger.
 *
 * Safety rules:
 * - every status change is a compare-and-set on the expected status, so a stop that left `triggered`/`executing`
 *   (or was cancelled while armed) is never acted on;
 * - executions are serialised per bot key and each stop is in flight at most once in this process; the signer lock
 *   keeps other processes out;
 * - the live position size is read in the same round trip as the mark right before every send, and `planClose`
 *   never sends more than it or on the opening side; a closed position ends DONE, a flipped one CANCELLED;
 * - a send whose outcome is unknown (the tx may be in flight) is never followed by another send until it is
 *   resolved: its receipt is found and recorded, or the bot has no pending tx (dropped). Until then the stop
 *   waits in `executing` and gives up after 15 s with `outcome_unknown`. The same check runs on resume, so a
 *   row left `sending`/`sent` by a crash is resolved before anything new is sent.
 */
export function createStopEngine(deps: StopEngineDeps): StopEngine {
  const { db, chain, kek, log } = deps;
  const now = deps.now ?? Date.now;
  const serial = new KeyedSerial();
  const inFlight = new Map<string, Promise<void>>();
  let stopped = false;

  const schedule = (stop: StopRow, market: MarketInfo | undefined): void => {
    if (stopped || inFlight.has(stop.id)) return;
    const job = serial
      .run(stop.botKeyId, () => execute(stop.id, market))
      .catch((err: unknown) => log.error({ err, stopId: stop.id }, "stop_execution_error"))
      .finally(() => inFlight.delete(stop.id));
    inFlight.set(stop.id, job);
  };

  async function execute(id: string, market: MarketInfo | undefined): Promise<void> {
    if (stopped) return;
    // Claim the stop. Fails when it was finished or changed since the tick listed it: nothing is sent.
    if (!(await transitionStop(db, id, IN_PROGRESS, "executing"))) {
      log.info({ stopId: id }, "stop_not_executable");
      return;
    }
    // Re-read after the claim: the tick's row may predate progress persisted by an earlier execution.
    const stop = await getStop(db, id);
    if (!stop) return;
    const { account, pool } = stop;
    const triggeredAt = stop.triggeredAt?.getTime() ?? now();
    const timedOut = () => now() - triggeredAt > STOP_GIVE_UP_MS;
    let attempt = stop.attempts;
    let closed = stop.closedRaw;
    let lastError = stop.lastError;

    const finish = async (event: StopEvent, reason: string | null = lastError): Promise<void> => {
      const to = nextStopStatus("executing", event);
      if (to === null) throw new Error(`no transition from executing on ${event}`);
      const patch = { attempts: attempt, closedRaw: closed, lastError: reason };
      if (!(await transitionStop(db, id, ["executing"], to, patch))) {
        log.warn({ stopId: id, to }, "stop_finish_lost");
        return;
      }
      if (to === "done") {
        const txHashes = (await listStopExecutions(db, id)).flatMap((e) =>
          e.status === "confirmed" && e.txHash ? [e.txHash] : [],
        );
        await insertAlert(db, {
          account,
          type: "stop_done",
          pool,
          payload: { stopId: id, pool, txHashes, closedRaw: closed.toString() },
        });
        log.info({ stopId: id, pool, event, closedRaw: closed.toString(), attempts: attempt }, "stop_done");
      } else if (to === "failed") {
        await insertAlert(db, { account, type: "stop_failed", pool, payload: { stopId: id, pool, reason } });
        log.warn({ stopId: id, pool, reason, attempts: attempt }, "stop_failed");
      } else {
        log.info({ stopId: id, pool, event }, "stop_cancelled");
      }
    };

    /** Nothing can be sent right now: keep the stop executing for the next tick, or give up after 15 s. */
    const defer = async (reason: string): Promise<void> => {
      lastError = reason;
      log.warn({ stopId: id, pool, reason }, "stop_execution_deferred");
      if (timedOut()) return finish("give_up", reason);
      await transitionStop(db, id, ["executing"], "executing", { lastError });
    };

    if (!market) return defer("market_unknown");

    // Decrypted for this execution only; never cached across executions, never logged.
    const key = await getBotKey(db, stop.botKeyId);
    if (!key?.address || !key.encPk || !key.encIv || !key.encTag || key.account !== account)
      return defer("bot_key_unavailable");
    const botAddress = key.address;
    let privateKey: Hex;
    try {
      privateKey = decryptPrivateKey({ encPk: key.encPk, iv: key.encIv, tag: key.encTag }, kek, key.id);
    } catch {
      return defer("bot_key_decrypt_failed");
    }

    /** The stop row is what a resumed execution trusts: false means it left `executing`, so stop acting. */
    const persist = () =>
      transitionStop(db, id, ["executing"], "executing", { attempts: attempt, closedRaw: closed, lastError });

    /** Records a mined outcome found after the fact. */
    const recordOutcome = async (exec: ExecutionRow, r: ReceiptResult): Promise<boolean> => {
      closed += r.filledRaw;
      lastError = r.reverted ? "reverted_onchain" : r.filledRaw > 0n ? null : "no_fill";
      if (!(await persist())) return false;
      await updateExecution(
        db,
        exec.id,
        r.reverted
          ? { status: "failed", txHash: r.txHash, gasUsed: r.gasUsed, error: "reverted_onchain" }
          : {
              status: "confirmed",
              txHash: r.txHash,
              orderId: r.orderId,
              filledRaw: r.filledRaw,
              avgPrice: r.avgPrice,
              gasUsed: r.gasUsed,
              error: null,
            },
      );
      log.info(
        { stopId: id, pool, txHash: r.txHash, filledRaw: r.filledRaw.toString(), reverted: r.reverted },
        "stop_close_resolved",
      );
      return true;
    };

    /**
     * Pre-send guard: resolve every execution of this stop whose outcome is not recorded (`sending`/`sent`).
     * "clear": none open. "changed": something was resolved, so every read must be redone. "wait": an outcome
     * is still unknown (or could not be checked): send nothing. "lost": the stop left `executing`.
     */
    const settleOpen = async (): Promise<"clear" | "changed" | "wait" | "lost"> => {
      const open = (await listStopExecutions(db, id)).filter(
        (e) => e.status === "sending" || e.status === "sent",
      );
      if (open.length === 0) return "clear";
      try {
        const unresolved: ExecutionRow[] = [];
        for (const e of open) {
          const r = e.txHash ? await chain.receiptOf(e.txHash as Hash, pool) : null;
          if (!r) unresolved.push(e);
          else if (!(await recordOutcome(e, r))) return "lost";
        }
        if (unresolved.length > 0) {
          if (await chain.hasPendingTx(botAddress)) return "wait";
          for (const e of unresolved) {
            // Nothing pending any more: it was mined just now (receipt visible), or it is gone for good.
            const r = e.txHash ? await chain.receiptOf(e.txHash as Hash, pool) : null;
            if (r) {
              if (!(await recordOutcome(e, r))) return "lost";
            } else {
              // Without a hash a mined tx cannot be told from a lost one; the fresh size read covers both.
              await updateExecution(db, e.id, {
                status: "failed",
                error: e.txHash ? "dropped" : "unresolved",
              });
              log.warn({ stopId: id, pool, txHash: e.txHash }, "stop_close_dropped");
            }
          }
        }
      } catch (err) {
        log.warn({ stopId: id, pool, err }, "stop_outcome_check_failed");
        return "wait";
      }
      return "changed";
    };

    for (;;) {
      if (stopped) return;
      const settled = await settleOpen();
      if (settled === "lost") return log.warn({ stopId: id }, "stop_progress_lost");
      if (settled === "wait") return defer("outcome_unknown");
      if (settled === "changed") continue;

      // Pending check, size and mark in one round trip, so the size is as fresh as possible when the order goes out.
      const [pendingRead, sizeRead, markRead] = await Promise.allSettled([
        chain.hasPendingTx(botAddress),
        chain.readPositionSize(account, pool),
        chain.readMark(pool),
      ]);
      if (sizeRead.status === "rejected") return defer(`size_read_failed: ${errorText(sizeRead.reason)}`);

      const plan = planClose({
        positionSize: sizeRead.value,
        stopSide: stop.positionSide,
        qtyMode: stop.qtyMode,
        qtyRaw: stop.qtyRaw,
        closedSoFarRaw: closed,
        lotSize: market.lotSize,
        minQuantity: market.minQuantity,
      });
      if (plan.action === "stop") return finish(plan.event);
      if (plan.action === "fail") return finish("give_up", plan.reason);
      // Checked after a fresh size read, so a final attempt that did fill ends DONE above rather than FAILED.
      if (attempt >= STOP_MAX_ATTEMPTS || timedOut()) {
        return finish("give_up", lastError ?? (attempt >= STOP_MAX_ATTEMPTS ? "max_attempts" : "timeout"));
      }

      // A tx from the bot that this stop has no record of: its effect is not in the size yet, so wait.
      if (pendingRead.status === "rejected") {
        return defer(`pending_check_failed: ${errorText(pendingRead.reason)}`);
      }
      if (pendingRead.value) return defer("tx_pending");
      if (markRead.status === "rejected") return defer(`mark_read_failed: ${errorText(markRead.reason)}`);
      const mark = markRead.value;
      if (mark.fromIndex) log.warn({ stopId: id, pool, mark: mark.price.toString() }, "stale_mark");
      const priceBound = closePriceBound(
        mark.price,
        stop.positionSide,
        closeSlipBps(attempt, stop.maxSlipBps),
        market.tickSize,
      );

      if (stopped) return;
      const order = { owner: account, pool, isBid: plan.isBid, qtyRaw: plan.qtyRaw, priceBound };
      const execId = await recordExecution(db, {
        kind: "stop_close",
        status: "sending",
        account,
        pool,
        botKeyId: stop.botKeyId,
        stopId: id,
        isBid: order.isBid,
        qtyRaw: order.qtyRaw,
        priceBound,
      });
      let result: PlaceResult | null = null;
      let unknown: TxOutcomeUnknown | null = null;
      try {
        result = await chain.placeMarketFor(privateKey, order);
        closed += result.filledRaw;
        lastError = result.filledRaw > 0n ? null : "no_fill";
      } catch (err) {
        // Before broadcast (simulation revert, RPC error) nothing was sent: a plain failed attempt. By or after
        // broadcast the order may still fill: never resend until the guard at the top of the loop resolves it.
        if (err instanceof TxOutcomeUnknown) unknown = err;
        lastError = unknown ? "outcome_unknown" : errorText(err);
      }
      attempt += 1;

      if (unknown) {
        // The hash first: it is how the outcome gets resolved, by this loop or after a restart.
        await updateExecution(db, execId, {
          status: "sent",
          txHash: unknown.txHash,
          error: errorText(unknown.cause ?? unknown),
        });
        log.warn(
          { stopId: id, pool, txHash: unknown.txHash, attempt: attempt - 1 },
          "stop_close_outcome_unknown",
        );
      }
      if (!(await persist())) {
        log.warn({ stopId: id }, "stop_progress_lost");
        return;
      }
      if (unknown) continue;
      if (result) {
        await updateExecution(db, execId, {
          status: "confirmed",
          txHash: result.txHash,
          orderId: result.orderId,
          filledRaw: result.filledRaw,
          avgPrice: result.avgPrice,
          gasUsed: result.gasUsed,
        });
        log.info(
          {
            stopId: id,
            pool,
            txHash: result.txHash,
            qtyRaw: order.qtyRaw.toString(),
            filledRaw: result.filledRaw.toString(),
            priceBound: priceBound.toString(),
            attempt: attempt - 1,
            ms_since_trigger: now() - triggeredAt,
          },
          "stop_close_sent",
        );
      } else {
        await updateExecution(db, execId, { status: "failed", error: lastError });
        log.warn({ stopId: id, pool, attempt: attempt - 1, error: lastError }, "stop_close_attempt_failed");
      }
    }
  }

  const idle = async (): Promise<void> => {
    while (inFlight.size > 0) await Promise.allSettled([...inFlight.values()]);
  };

  return {
    async tick() {
      if (stopped) return;
      const stops = await listStops(db, ["armed", ...IN_PROGRESS]);
      if (stops.length === 0) return;
      const markets = new Map((await chain.markets()).map((m) => [lower(m.pool), m]));

      const armed = stops.filter((s) => s.status === "armed");
      const pools = [...new Set(armed.map((s) => s.pool))];
      const reads = await Promise.allSettled(pools.map((p) => chain.readMark(p)));
      const marks = new Map<Address, bigint>();
      pools.forEach((pool, i) => {
        const r = reads[i];
        if (!r) return;
        if (r.status === "rejected") {
          // A failed read never triggers: that pool is simply not evaluated this tick.
          log.warn({ pool, err: r.reason }, "mark_read_failed");
          return;
        }
        if (r.value.fromIndex) log.warn({ pool, mark: r.value.price.toString() }, "stale_mark");
        marks.set(pool, r.value.price);
      });

      for (const s of armed) {
        if (stopped) return;
        const mark = marks.get(s.pool);
        if (mark === undefined || !isTriggered(s.positionSide, s.triggerPrice, mark)) continue;
        const market = markets.get(s.pool);
        if (!market) {
          // Without its lot and tick sizes the close cannot be planned: stay armed rather than trigger blind.
          log.warn({ stopId: s.id, pool: s.pool }, "stop_market_unknown");
          continue;
        }
        if (!(await transitionStop(db, s.id, ["armed"], "triggered", { triggeredAt: new Date(now()) })))
          continue;
        log.info(
          { stopId: s.id, pool: s.pool, mark: mark.toString(), trigger: s.triggerPrice.toString() },
          "stop_triggered",
        );
        schedule(s, market);
      }

      // Restart catch-up (and retries of deferred executions): anything mid-flight that is not running here.
      for (const s of stops) {
        if (IN_PROGRESS.includes(s.status)) schedule(s, markets.get(s.pool));
      }
    },
    idle,
    async stop() {
      stopped = true;
      await idle();
    },
  };
}
