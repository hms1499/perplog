import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import { migrationsFolder } from "./paths";
import * as schema from "./schema";

/** Satisfied by both the node-postgres and the PGlite drizzle instances (and by transactions). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createDb(
  url: string,
  onError?: (err: Error) => void,
  options: { max?: number } = {},
): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, max: options.max });
  // An idle-client error with no listener would be an uncaught exception and kill the worker.
  pool.on("error", onError ?? ((e) => console.error("pg pool error", e)));
  return { db: drizzle(pool, { schema }), pool };
}

export async function migrateDb(db: Db): Promise<void> {
  // The node-postgres migrator is typed for its own driver; the runtime only needs the shared PgDatabase API.
  await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: migrationsFolder() });
}
