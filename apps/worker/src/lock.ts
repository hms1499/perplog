import { SIGNER_LOCK_ID } from "@perplog/core";

/** A dedicated Postgres session. The advisory lock lives exactly as long as this connection. */
export interface LockConn {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** Only the holder of the session-level advisory lock may sign. Never blocks; false means stay standby. */
export async function tryAcquireSignerLock(conn: LockConn): Promise<boolean> {
  const { rows } = await conn.query(`SELECT pg_try_advisory_lock(${SIGNER_LOCK_ID}) AS ok`);
  return rows[0]?.ok === true;
}
