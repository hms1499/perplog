import { createDb, migrateDb } from "@perplog/db";
import { liveChain, networkFromEnv } from "./chain-live";
import { parseEnv } from "./env";
import { createLogger } from "./log";
import { startWorker } from "./start";

const env = parseEnv(process.env);
const log = createLogger(env.LOG_LEVEL);

const { db, pool } = createDb(env.DATABASE_URL, (err) => log.error({ err }, "pg pool error"));

// The signer lock lives and dies with this one connection, so it is never returned to the pool.
const lockClient = await pool.connect();
lockClient.on("error", (err) => {
  // Losing the session loses the lock: another worker may already be signing. Exit and let the host restart us.
  log.error({ err }, "signer lock connection lost, exiting");
  process.exit(1);
});

const worker = await startWorker({
  db,
  lockConn: lockClient,
  migrate: () => migrateDb(db),
  env,
  chain: liveChain(networkFromEnv(env)),
  log,
  // The lock heartbeat failed: the loops are already stopped. Exit and let the host restart us; in-progress
  // stops resume on the next boot (re-reading the size first).
  onFatal: () => process.exit(1),
});

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "shutting down");
  try {
    await worker.stop();
    lockClient.release();
    await pool.end();
  } catch (err) {
    log.error({ err }, "shutdown failed");
    process.exit(1);
  }
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
