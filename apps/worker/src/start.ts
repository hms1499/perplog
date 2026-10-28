import { MARK_POLL_MS } from "@perplog/core";
import type { Db } from "@perplog/db";
import { createAlertEngine } from "./alert-engine";
import { mintRequestedKeys } from "./bot-key-minter";
import { createEntryEngine } from "./entry-engine";
import type { WorkerEnv } from "./env";
import { GAS_TREASURY_INTERVAL_MS, topUpBots } from "./gas-treasury";
import { checkLinks } from "./link-watcher";
import { type LockConn, tryAcquireSignerLock } from "./lock";
import type { Logger } from "./log";
import { every } from "./loop";
import type { ChainPort } from "./ports";
import { startReactivityListener } from "./reactivity-listener";
import { KeyedSerial } from "./serial";
import { createStopEngine } from "./stop-engine";

export const MINTER_INTERVAL_MS = 300;
export const ENTRY_POLL_MS = 300;
export const LINK_WATCHER_INTERVAL_MS = 60_000;
export const WATCHED_REFRESH_MS = 10_000;
const STANDBY_RETRY_MS = 10_000;
export const LOCK_HEARTBEAT_MS = 10_000;
/** How long a lost lock waits for in-flight work to wind down before `onFatal`; a dead DB must not block exit. */
const FATAL_DRAIN_MS = 5_000;

export interface WorkerDeps {
  db: Db;
  /** A dedicated connection: the advisory lock is held for as long as it stays open. */
  lockConn: LockConn;
  migrate: () => Promise<void>;
  env: WorkerEnv;
  chain: ChainPort;
  log: Logger;
  /** Called once the signer lock is lost and the loops are stopped. main.ts exits the process. */
  onFatal: (err: unknown) => void;
  standbyRetryMs?: number;
  lockHeartbeatMs?: number;
}

/** Rejects when `p` has not settled within `ms`. */
function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Boot sequence: take the signer lock (otherwise stay standby and retry), migrate, start the loops.
 * Resolves once the first attempt has finished; a standby worker keeps retrying in the background.
 *
 * While active, `SELECT 1` runs on the lock connection every `lockHeartbeatMs`. A failed or unanswered heartbeat
 * means the session (and so the lock) may be gone and another worker may already be signing: every loop is
 * stopped, no new order is sent, and `onFatal` is called.
 */
export async function startWorker(deps: WorkerDeps): Promise<{ stop(): Promise<void> }> {
  const { db, lockConn, migrate, env, log } = deps;
  const retryMs = deps.standbyRetryMs ?? STANDBY_RETRY_MS;
  const heartbeatMs = deps.lockHeartbeatMs ?? LOCK_HEARTBEAT_MS;
  const loops: Array<{ stop(): Promise<void> }> = [];
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setTimeout> | null = null;

  const halt = async (): Promise<void> => {
    stopped = true;
    if (retry !== null) clearTimeout(retry);
    retry = null;
    if (heartbeat !== null) clearTimeout(heartbeat);
    heartbeat = null;
    // Each loop's stop() flips its own flag synchronously, so nothing new starts even while we wait here.
    await Promise.all(loops.map((l) => l.stop()));
  };

  const beat = async (): Promise<void> => {
    heartbeat = null;
    if (stopped) return;
    try {
      await within(lockConn.query("SELECT 1"), heartbeatMs);
    } catch (err) {
      if (stopped) return;
      log.error({ err }, "signer_lock_lost");
      await within(halt(), FATAL_DRAIN_MS).catch(() => log.error("loops did not stop in time"));
      deps.onFatal(err);
      return;
    }
    if (!stopped) heartbeat = setTimeout(() => void beat(), heartbeatMs);
  };

  const attempt = async (): Promise<void> => {
    if (stopped) return;
    let active = false;
    try {
      if (await tryAcquireSignerLock(lockConn)) {
        log.info("signer lock acquired");
        await migrate();
        log.info("migrations applied");
        if (stopped) return;
        loops.push(
          every(
            MINTER_INTERVAL_MS,
            "bot-key-minter",
            async () => {
              const n = await mintRequestedKeys(db, env.KEY_ENCRYPTION_KEY);
              if (n > 0) log.info({ count: n }, "bot keys minted");
            },
            log,
          ),
          every(LINK_WATCHER_INTERVAL_MS, "link-watcher", () => checkLinks(db, deps.chain, log), log),
        );
        // One send queue per bot key, shared by both engines: a key never has a stop close and an entry in flight.
        const serial = new KeyedSerial();
        const engine = createStopEngine({ db, chain: deps.chain, kek: env.KEY_ENCRYPTION_KEY, log, serial });
        const poll = every(MARK_POLL_MS, "stop-engine", () => engine.tick(), log);
        // Stopping the poll alone would leave scheduled executions running: stop the engine too.
        loops.push({ stop: () => Promise.all([poll.stop(), engine.stop()]).then(() => undefined) });
        const entries = createEntryEngine({
          db,
          chain: deps.chain,
          kek: env.KEY_ENCRYPTION_KEY,
          log,
          serial,
        });
        const entryPoll = every(ENTRY_POLL_MS, "entry-engine", () => entries.tick(), log);
        loops.push({ stop: () => Promise.all([entryPoll.stop(), entries.stop()]).then(() => undefined) });
        const alerts = createAlertEngine({ db, chain: deps.chain, log });
        const watchedRefresh = every(
          WATCHED_REFRESH_MS,
          "watched-accounts",
          () => alerts.refreshWatched(),
          log,
        );
        const listener = startReactivityListener(deps.chain, alerts, log);
        loops.push({
          stop: async () => {
            alerts.stop();
            await Promise.all([watchedRefresh.stop(), listener.stop(), alerts.idle()]);
          },
        });
        const treasuryKey = env.TREASURY_PRIVATE_KEY;
        if (treasuryKey) {
          loops.push(
            every(
              GAS_TREASURY_INTERVAL_MS,
              "gas-treasury",
              () => topUpBots({ db, chain: deps.chain, treasuryKey, env, log }),
              log,
            ),
          );
        } else {
          log.warn({ reason: "TREASURY_PRIVATE_KEY is not set" }, "gas treasury disabled");
        }
        heartbeat = setTimeout(() => void beat(), heartbeatMs);
        active = true;
      } else {
        log.info({ retryMs }, "standby");
      }
    } catch (err) {
      log.error({ err }, "worker start failed, will retry");
    }
    if (!active && !stopped) retry = setTimeout(() => void attempt(), retryMs);
  };

  await attempt();

  return { stop: halt };
}
