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
  pools: Address[],
  log: Logger,
): Promise<void> {
  const account = key.account as Address;
  const granted = (await chain.grantedPools(account, key.address as Address, pools)).map(
    (p) => p.toLowerCase() as Address,
  );
  const grantedSet = new Set(granted);

  await setLinkedPools(db, key.id, granted, granted.length > 0 ? "linked" : "revoked");

  // Stops belong to the key that will sign for them, so only this key's grants decide their fate.
  const armed = (await listAccountStops(db, account, ["armed"])).filter((s) => s.botKeyId === key.id);
  const lost = new Set<Address>();
  for (const s of armed) {
    if (grantedSet.has(s.pool)) continue;
    if (await transitionStop(db, s.id, ["armed"], "paused")) lost.add(s.pool);
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

  const paused = (await listAccountStops(db, account, ["paused"])).filter((s) => s.botKeyId === key.id);
  for (const s of paused) {
    if (!grantedSet.has(s.pool)) continue;
    if (await transitionStop(db, s.id, ["paused"], "armed")) {
      log.info({ botKeyId: key.id, account, pool: s.pool }, "grant restored, stop re-armed");
    }
  }
}
