import { createDb, type Db } from "@perplog/db";

// One small pool per lambda instance; stashed on globalThis so dev HMR does not leak pools.
const holder = globalThis as typeof globalThis & { __perplogDb?: Db };

/** The Postgres handle, or null when DATABASE_URL is unset (protection routes then answer 503 db_unavailable). */
export function getDb(): Db | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  holder.__perplogDb ??= createDb(url, undefined, { max: 3 }).db;
  return holder.__perplogDb;
}
