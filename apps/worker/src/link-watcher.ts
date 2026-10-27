import type { Address } from "@perplog/core";
import {
  type BotKeyRow,
  type Db,
  insertAlert,
  listAccountStops,
  listBotKeysByStatus,
  setLinkedPools,
  transitionStop,
} from "@perplog/db";
import type { Logger } from "./log";
import type { ChainPort } from "./ports";

const ALERT_DEDUPE_SEC = 3600;

/**
 * One LinkWatcher tick. For every linked or revoked bot key, re-reads which perp pools still grant it
 * `placeOrderFor`, stores the result, pauses armed stops on pools that lost the grant (one `link_revoked`
 * alert per key) and re-arms paused stops on pools that have it. A failed read skips that key: it never pauses.
 */
export async function checkLinks(db: Db, chain: ChainPort, log: Logger): Promise<void> {
  const keys = await listBotKeysByStatus(db, ["linked", "revoked"]);
  const watched = keys.filter((k) => k.account !== null && k.address !== null);
  if (watched.length === 0) return;

  // An empty market list means a bad read, not "no grants": checking against it would pause everything.
  const pools = (await chain.markets()).map((m) => m.pool.toLowerCase() as Address);
  if (pools.length === 0) {
    log.warn("link check skipped: no perp markets");
    return;
  }

  for (const key of watched) {
    try {
      await checkKey(db, chain, key, pools, log);
    } catch (err) {
      log.warn({ err, botKeyId: key.id }, "link check failed, key skipped");
    }
  }
}

async function checkKey(
  db: Db,
  chain: ChainPort,
  key: BotKeyRow,
  marketPools: Address[],
  log: Logger,
): Promise<void> {
  const account = key.account as Address;
  // Stops belong to the key that will sign for them, so only this key's grants decide their fate.
  // Listed before the grant read so every stop we judge has its pool in the queried set.
  const stops = (await listAccountStops(db, account, ["armed", "paused"])).filter(
    (s) => s.botKeyId === key.id,
  );
  // The cached market list can lag (a market listed after the cache fill) or be partial, so a stop's pool is
  // always queried too: absence from the list must never read as a lost grant.
  const queried = [...new Set<Address>([...marketPools, ...stops.map((s) => s.pool)])];
  const granted = (await chain.grantedPools(account, key.address as Address, queried)).map(
    (p) => p.toLowerCase() as Address,
  );
  const grantedSet = new Set(granted);

  await setLinkedPools(db, key.id, granted, granted.length > 0 ? "linked" : "revoked");

  const lost = new Set<Address>();
  for (const s of stops) {
    if (grantedSet.has(s.pool)) continue;
    if (s.status === "armed" && (await transitionStop(db, s.id, ["armed"], "paused"))) lost.add(s.pool);
  }
  if (lost.size > 0) {
    const lostPools = [...lost];
    log.warn({ botKeyId: key.id, account, pools: lostPools }, "grant lost, stops paused");
    await insertAlert(db, {
      account,
      type: "link_revoked",
      payload: { pools: lostPools },
      dedupeWithinSec: ALERT_DEDUPE_SEC,
    });
  }

  for (const s of stops) {
    if (s.status !== "paused" || !grantedSet.has(s.pool)) continue;
    if (await transitionStop(db, s.id, ["paused"], "armed")) {
      log.info({ botKeyId: key.id, account, pool: s.pool }, "grant restored, stop re-armed");
    }
  }
}
