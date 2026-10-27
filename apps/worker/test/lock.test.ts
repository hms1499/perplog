import { PGlite } from "@electric-sql/pglite";
import { SIGNER_LOCK_ID } from "@perplog/core";
import { tryAcquireSignerLock } from "../src/lock";

function recordingConn(rows: Array<Record<string, unknown>>) {
  const sent: string[] = [];
  return {
    sent,
    conn: {
      async query(sql: string) {
        sent.push(sql);
        return { rows };
      },
    },
  };
}

test("sends exactly pg_try_advisory_lock(7331) and maps ok to a boolean", async () => {
  expect(SIGNER_LOCK_ID).toBe(7331);
  const granted = recordingConn([{ ok: true }]);
  expect(await tryAcquireSignerLock(granted.conn)).toBe(true);
  expect(granted.sent).toEqual(["SELECT pg_try_advisory_lock(7331) AS ok"]);

  const refused = recordingConn([{ ok: false }]);
  expect(await tryAcquireSignerLock(refused.conn)).toBe(false);
});

test("anything other than ok === true counts as not acquired", async () => {
  expect(await tryAcquireSignerLock(recordingConn([]).conn)).toBe(false);
  expect(await tryAcquireSignerLock(recordingConn([{ ok: null }]).conn)).toBe(false);
});

test("a free lock on a real Postgres (PGlite) is acquired", async () => {
  const pg = new PGlite();
  const conn = {
    async query(sql: string) {
      const r = await pg.query<Record<string, unknown>>(sql);
      return { rows: r.rows };
    },
  };
  expect(await tryAcquireSignerLock(conn)).toBe(true);
});
