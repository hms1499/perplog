import type { Db } from "@perplog/db";
import { mintRequestedKeys } from "./bot-key-minter";
import type { WorkerEnv } from "./env";
import { checkLinks } from "./link-watcher";
import { type LockConn, tryAcquireSignerLock } from "./lock";
import type { Logger } from "./log";
import { every } from "./loop";
import type { ChainPort } from "./ports";

export const MINTER_INTERVAL_MS = 300;
export const LINK_WATCHER_INTERVAL_MS = 60_000;
const STANDBY_RETRY_MS = 10_000;

export interface WorkerDeps {
  db: Db;
  /** A dedicated connection: the advisory lock is held for as long as it stays open. */
  lockConn: LockConn;
  migrate: () => Promise<void>;
  env: WorkerEnv;
  /** Unused by the minter; the loops added in later tasks take their chain access from here. */
  chain: ChainPort;
  log: Logger;
  standbyRetryMs?: number;
}

/**
 * Boot sequence: take the signer lock (otherwise stay standby and retry), migrate, start the loops.
 * Resolves once the first attempt has finished; a standby worker keeps retrying in the background.
 */
export async function startWorker(deps: WorkerDeps): Promise<{ stop(): Promise<void> }> {
  const { db, lockConn, migrate, env, log } = deps;
  const retryMs = deps.standbyRetryMs ?? STANDBY_RETRY_MS;
  const loops: Array<{ stop(): Promise<void> }> = [];
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | null = null;

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

  return {
    async stop() {
      stopped = true;
      if (retry !== null) clearTimeout(retry);
      retry = null;
      await Promise.all(loops.map((l) => l.stop()));
    },
  };
}
