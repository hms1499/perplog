import {
  OperatorRevert,
  type PlaceResult,
  type ReceiptResult,
  TxOutcomeUnknown,
} from "@perplog/chain/signer";
import { type Address, ENTRY_MAX_AGE_MS } from "@perplog/core";
import {
  claimQueuedEntries,
  type Db,
  type ExecutionRow,
  getBotKey,
  listOpenEntries,
  requeueEntry,
  settleEntryFailed,
  settleEntryFilled,
  updateExecution,
} from "@perplog/db";
import { decryptPrivateKey } from "@perplog/db/crypto";
import type { Hash, Hex } from "viem";
import type { Logger } from "./log";
import type { ChainPort } from "./ports";
import type { KeyedSerial } from "./serial";
import { errorText } from "./stop-engine";

export interface EntryEngineDeps {
  db: Db;
  chain: ChainPort;
  kek: Buffer;
  log: Logger;
  /** Shared with the StopEngine: one bot key never has two orders in flight. */
  serial: KeyedSerial;
  now?: () => number;
}

export interface EntryEngine {
  /** Resolves entries with an unknown outcome, then sends newly queued ones. */
  tick(): Promise<void>;
  idle(): Promise<void>;
  stop(): Promise<void>;
}

const CLAIM_LIMIT = 10;

/**
 * Sends the IOC entry of each confirmed plan. This is the ONLY order the worker may send that opens exposure, so:
 * - an entry is sent at most once: it is never retried or resent, including after a restart. An unknown outcome is
 *   resolved from its receipt, or failed `dropped` once the bot has nothing pending;
 * - it is sent only while the account is flat on the pool and the plan is younger than ENTRY_MAX_AGE_MS;
 * - its quantity and price bound are the server-quoted ones stored on the execution;
 * - a fill arms the plan's `entire` stop in the same transaction (settleEntryFilled).
 */
export function createEntryEngine(deps: EntryEngineDeps): EntryEngine {
  const { db, chain, kek, log, serial } = deps;
  const now = deps.now ?? Date.now;
  const inFlight = new Map<string, Promise<void>>();
  let stopped = false;

  const fail = async (e: ExecutionRow, reason: string, txHash?: string | null): Promise<void> => {
    if (await settleEntryFailed(db, { executionId: e.id, error: reason, txHash })) {
      log.warn({ executionId: e.id, planId: e.planId, pool: e.pool, reason, txHash }, "entry_failed");
    }
  };

  const botAddress = async (e: ExecutionRow): Promise<Address | null> =>
    ((await getBotKey(db, e.botKeyId))?.address as Address | null | undefined) ?? null;

  /** Settles an entry from its mined receipt. */
  async function settleFrom(e: ExecutionRow, r: ReceiptResult): Promise<void> {
    if (r.reverted) return fail(e, "reverted_onchain", r.txHash);
    if (r.filledRaw === 0n) return fail(e, "no_fill", r.txHash);
    const { reverted: _reverted, blockNumber: _block, stepsMs: _steps, ...fill } = r;
    if (await settleEntryFilled(db, { executionId: e.id, fill })) {
      log.info({ executionId: e.id, planId: e.planId, txHash: r.txHash }, "entry_resolved");
    }
  }

  /** An entry whose outcome is not recorded (`sending` after a crash, or `sent`): settle it, never resend it. */
  async function resolve(e: ExecutionRow): Promise<void> {
    const hash = e.txHash as Hash | null;
    if (hash) {
      const r = await chain.receiptOf(hash, e.pool);
      if (r) return settleFrom(e, r);
    }
    const bot = await botAddress(e);
    if (bot && (await chain.hasPendingTx(bot))) return;
    if (hash) {
      // Nothing pending any more: it was mined just now (receipt visible), or it is gone for good.
      const r = await chain.receiptOf(hash, e.pool);
      return r ? settleFrom(e, r) : fail(e, "dropped", hash);
    }
    // No hash, nothing pending. The account was flat on this pool right before the send (checked under the
    // per-key serial), so a position on the plan's side now means the entry filled: arm its stop.
    const size = await chain.readPositionSize(e.account, e.pool);
    const filled = e.isBid ? size : -size;
    if (filled > 0n) {
      const fill = {
        txHash: null,
        orderId: null,
        // biome-ignore lint/complexity/useMathMinMax: bigint operands; Math.min only takes numbers
        filledRaw: filled < e.qtyRaw ? filled : e.qtyRaw,
        avgPrice: null,
        gasUsed: 0n,
      };
      if (await settleEntryFilled(db, { executionId: e.id, fill })) {
        log.warn(
          { executionId: e.id, planId: e.planId, filledRaw: fill.filledRaw.toString() },
          "entry_inferred_fill",
        );
      }
      return;
    }
    return fail(e, "unresolved");
  }

  async function send(e: ExecutionRow): Promise<void> {
    if (stopped) {
      await requeueEntry(db, e.id);
      return;
    }
    const queuedMs = now() - e.createdAt.getTime();
    if (queuedMs > ENTRY_MAX_AGE_MS) return fail(e, "expired");

    // Decrypted for this send only; never cached, never logged.
    const key = await getBotKey(db, e.botKeyId);
    if (!key?.address || !key.encPk || !key.encIv || !key.encTag || key.account !== e.account) {
      return fail(e, "bot_key_unavailable");
    }
    let privateKey: Hex;
    try {
      privateKey = decryptPrivateKey({ encPk: key.encPk, iv: key.encIv, tag: key.encTag }, kek, key.id);
    } catch {
      return fail(e, "bot_key_decrypt_failed");
    }

    let size: bigint;
    try {
      if (await chain.hasPendingTx(key.address as Address)) {
        await requeueEntry(db, e.id);
        return;
      }
      size = await chain.readPositionSize(e.account, e.pool);
    } catch (err) {
      // Nothing was sent: try again next tick; the age limit bounds the retries.
      log.warn({ executionId: e.id, err: errorText(err) }, "entry_precheck_failed");
      await requeueEntry(db, e.id);
      return;
    }
    if (size !== 0n) return fail(e, "position_changed");

    if (stopped) {
      await requeueEntry(db, e.id);
      return;
    }
    const order = {
      owner: e.account,
      pool: e.pool,
      isBid: e.isBid,
      qtyRaw: e.qtyRaw,
      priceBound: e.priceBound,
    };
    // Only the send is guarded: a failure after it (writing the outcome) must not be mistaken for "nothing sent".
    let result: PlaceResult;
    try {
      result = await chain.placeMarketFor(privateKey, order);
    } catch (err) {
      if (err instanceof TxOutcomeUnknown) {
        // The hash first: it is how the outcome gets resolved, by the next tick or after a restart.
        await updateExecution(db, e.id, {
          status: "sent",
          txHash: err.txHash,
          error: errorText(err.cause ?? err),
        });
        log.warn({ executionId: e.id, txHash: err.txHash }, "entry_outcome_unknown");
        return;
      }
      // Before broadcast (simulation revert, RPC error): nothing was sent, and an entry is never retried.
      return fail(e, err instanceof OperatorRevert ? err.errorName : errorText(err));
    }
    if (result.filledRaw === 0n) return fail(e, "no_fill", result.txHash);
    // The hash first: if settling fails below, the next tick re-settles from this receipt instead of guessing.
    await updateExecution(db, e.id, { status: "sent", txHash: result.txHash });
    const { blockNumber: _block, stepsMs, ...fill } = result;
    await settleEntryFilled(db, { executionId: e.id, fill });
    log.info(
      {
        executionId: e.id,
        planId: e.planId,
        pool: e.pool,
        txHash: result.txHash,
        qtyRaw: e.qtyRaw.toString(),
        filledRaw: result.filledRaw.toString(),
        ms_since_queued: now() - e.createdAt.getTime(),
        place_steps: stepsMs,
      },
      "entry_sent",
    );
  }

  const schedule = (e: ExecutionRow, job: () => Promise<void>): void => {
    if (inFlight.has(e.id)) return;
    const run = serial
      .run(e.botKeyId, job)
      .catch((err: unknown) => log.error({ err, executionId: e.id }, "entry_execution_error"))
      .finally(() => inFlight.delete(e.id));
    inFlight.set(e.id, run);
  };

  const idle = async (): Promise<void> => {
    while (inFlight.size > 0) await Promise.allSettled([...inFlight.values()]);
  };

  return {
    async tick() {
      if (stopped) return;
      for (const e of await listOpenEntries(db)) {
        if (!inFlight.has(e.id)) schedule(e, () => resolve(e));
      }
      if (stopped) return;
      for (const e of await claimQueuedEntries(db, CLAIM_LIMIT)) schedule(e, () => send(e));
    },
    idle,
    async stop() {
      stopped = true;
      await idle();
    },
  };
}
