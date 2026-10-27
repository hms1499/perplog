import {
  type AccountHistory,
  type Address,
  attributeCosts,
  buildHealthSummary,
  type CostAttribution,
  computeLeaks,
  type EnrichedTrade,
  type ExitType,
  enrichTrades,
  filterFundingRange,
  filterRange,
  type HealthSummary,
  type Leak,
  type LeakId,
  type MarketInfo,
  type OpenPosition,
  type QtyMode,
  type Range,
  type ReconcileResult,
  reconcile,
  reconstructTrades,
  type Side,
  type StopStatus,
} from "@perplog/core";
import { LRUCache } from "lru-cache";

/** An RPC read failed; maps to HTTP 503 `chain_unavailable`. */
export class ChainUnavailableError extends Error {
  override readonly name = "ChainUnavailableError";
  constructor(cause: unknown) {
    super(`chain read failed: ${(cause as Error)?.message ?? String(cause)}`, { cause });
  }
}

/** A PerpLog (bot-held) stop as the Positions API and the stops routes show it. */
export interface StopView {
  id: string;
  pool: Address;
  positionSide: Side;
  triggerPrice: bigint;
  qtyMode: QtyMode;
  qtyRaw: bigint | null;
  status: StopStatus;
}

export type PositionView = OpenPosition & { perplogStop: StopView | null };

export interface AccountData {
  account: Address;
  markets: Map<Address, MarketInfo>;
  history: AccountHistory;
  /** Null when the on-chain read failed; the report still renders, unreconciled. */
  collateralRaw: bigint | null;
  activePools: Address[];
  attribution: CostAttribution;
  trades: EnrichedTrade[];
  reconcile: ReconcileResult | null;
  asOfTimestamp: number;
  empty: boolean;
}

export interface AccountServiceDeps {
  fetchMarkets(): Promise<MarketInfo[]>;
  fetchHistory(account: Address, perpPools: ReadonlySet<Address>): Promise<AccountHistory>;
  fetchCollateral(account: Address): Promise<{ collateralRaw: bigint; activePools: Address[] }>;
  fetchOpenPositions(account: Address, data: AccountData): Promise<OpenPosition[]>;
  /** The account's live PerpLog stops (armed, paused, triggered, executing). Absent without a database. */
  fetchPerplogStops?(account: Address): Promise<StopView[]>;
  /** Tx hashes of the bot's stop-close orders, so exits through them classify as PERPLOG_STOP. */
  fetchPerplogStopTxs?(account: Address): Promise<Set<string>>;
  /**
   * Unix seconds. With an account, the "now" its ranges are measured from:
   * fixture mode pins each account to its own capture time.
   */
  now(account?: Address): number;
}

export type HealthResponse = HealthSummary & {
  empty: boolean;
  truncated: boolean;
  chainReadFailed: boolean;
  asOfTimestamp: number;
};

export interface TradesQuery {
  range: Range;
  market?: Address;
  exit?: ExitType;
  side?: Side;
  /** Only the trades that are evidence for this leak in the range. */
  leak?: LeakId;
  cursor?: string;
  limit?: number;
}

const MARKETS_TTL_SEC = 600;
/** How long a report built without the on-chain read is served before retrying. */
const DEGRADED_TTL_SEC = 10;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** A 20k-change account measured about 1KB of heap per row, so this caps the cache near 250MB. */
const CACHE_MAX_ROWS = 250_000;

interface Entry<T> {
  value: Promise<T>;
  expiresAt: number;
  /** Rows held once loaded; 1 while pending. */
  rows?: number;
}

/** Armed, triggered and executing stops protect the position; a paused one (grant gone) does not. */
const COVERING: readonly StopStatus[] = ["armed", "triggered", "executing"];

function withPerplogStop(position: OpenPosition, stops: StopView[]): PositionView {
  const mine = stops.filter((s) => s.pool === position.pool && s.positionSide === position.side);
  // At most one armed/paused stop exists per pool; a triggered or executing one may sit beside it.
  const stop =
    mine.find((s) => s.status === "armed" || s.status === "paused") ??
    mine.find((s) => s.status === "triggered" || s.status === "executing") ??
    null;
  if (!stop) return { ...position, perplogStop: null };
  const size = position.sizeRaw < 0n ? -position.sizeRaw : position.sizeRaw;
  let perplog = 0n;
  if (COVERING.includes(stop.status)) {
    perplog = stop.qtyMode === "entire" || size === 0n ? 10_000n : ((stop.qtyRaw ?? 0n) * 10_000n) / size;
  }
  const coverage = Math.min(10_000, position.stopCoverageBps + Number(perplog > 10_000n ? 10_000n : perplog));
  return { ...position, perplogStop: stop, stopCoverageBps: coverage };
}

const rowsOf = (data: AccountData): number => {
  const h = data.history;
  return (
    1 +
    data.trades.length +
    h.changes.length +
    h.funding.length +
    h.fees.length +
    h.marginEvents.length +
    h.marginPulls.length +
    h.liquidations.length +
    h.stopOrders.length
  );
};

export function createAccountService(
  deps: AccountServiceDeps,
  cacheTtlMs = 60_000,
  cacheMaxRows = CACHE_MAX_ROWS,
) {
  const ttlSec = cacheTtlMs / 1000;
  const accounts = new LRUCache<Address, Entry<AccountData>>({
    max: 500,
    maxSize: cacheMaxRows,
    sizeCalculation: (entry) => entry.rows ?? 1,
  });
  let markets: Entry<MarketInfo[]> | undefined;

  function cached<T>(entry: Entry<T> | undefined, ttl: number, load: () => Promise<T>): Entry<T> {
    if (entry && entry.expiresAt > deps.now()) return entry;
    const fresh: Entry<T> = { value: load(), expiresAt: deps.now() + ttl };
    // A failed load must not stay cached.
    fresh.value.catch(() => {
      fresh.expiresAt = 0;
    });
    return fresh;
  }

  async function loadAccount(account: Address): Promise<AccountData> {
    markets = cached(markets, MARKETS_TTL_SEC, () => deps.fetchMarkets());
    const marketList = await markets.value;
    const marketMap = new Map(marketList.map((m) => [m.pool, m]));
    // Collateral only feeds the reconcile badge and the positions read, so an RPC
    // failure must not take the indexer-backed report down with it.
    const [history, collateral, perplogStopTxs] = await Promise.all([
      deps.fetchHistory(account, new Set(marketMap.keys())),
      deps.fetchCollateral(account).catch((error: unknown) => {
        console.error(error);
        return null;
      }),
      // Only the exit label depends on this, so a database hiccup degrades to MANUAL rather than failing.
      (deps.fetchPerplogStopTxs?.(account) ?? Promise.resolve(new Set<string>())).catch((error: unknown) => {
        console.error(error);
        return new Set<string>();
      }),
    ]);
    const attribution = attributeCosts(
      reconstructTrades(account, history.changes),
      history.funding,
      history.fees,
    );
    const trades = enrichTrades(attribution, history, marketMap, history.asOfTimestamp, perplogStopTxs);
    return {
      account,
      markets: marketMap,
      history,
      collateralRaw: collateral?.collateralRaw ?? null,
      activePools: collateral?.activePools ?? [],
      attribution,
      trades,
      reconcile: history.truncated || !collateral ? null : reconcile(history, collateral.collateralRaw),
      asOfTimestamp: history.asOfTimestamp,
      empty: history.changes.length === 0,
    };
  }

  async function getAccountData(account: Address): Promise<AccountData> {
    const previous = accounts.get(account);
    const entry = cached(previous, ttlSec, () => loadAccount(account));
    if (entry !== previous) {
      entry.value.then(
        (data) => {
          if (data.collateralRaw === null) {
            entry.expiresAt = Math.min(entry.expiresAt, deps.now() + DEGRADED_TTL_SEC);
          }
          // lru-cache only recomputes a size when the value changes, so re-insert it.
          entry.rows = rowsOf(data);
          if (accounts.peek(account) === entry) {
            accounts.delete(account);
            accounts.set(account, entry);
          }
        },
        () => {},
      );
    }
    accounts.set(account, entry);
    return entry.value;
  }

  async function getHealth(account: Address, range: Range): Promise<HealthResponse> {
    const data = await getAccountData(account);
    const summary = buildHealthSummary({
      trades: data.trades,
      unattributedFunding: data.attribution.unattributedFunding,
      range,
      nowSec: deps.now(account),
      reconcile: data.reconcile,
    });
    return {
      ...summary,
      empty: data.empty,
      truncated: data.history.truncated,
      chainReadFailed: data.collateralRaw === null,
      asOfTimestamp: data.asOfTimestamp,
    };
  }

  async function getTrades(
    account: Address,
    q: TradesQuery,
  ): Promise<{ trades: EnrichedTrade[]; nextCursor: string | null; empty: boolean }> {
    const data = await getAccountData(account);
    const inRange = filterRange(data.trades, q.range, deps.now(account));
    const open = q.range === "all" ? data.trades.filter((t) => t.closedAt === null) : [];
    const evidence = q.leak ? leakEvidence(data, q.leak, q.range) : null;
    const filtered = [...open, ...inRange]
      .filter((t) => !evidence || evidence.has(t.id))
      .filter((t) => !q.market || t.pool === q.market)
      .filter((t) => !q.exit || t.exitType === q.exit)
      .filter((t) => !q.side || t.side === q.side)
      .sort((a, b) => (b.closedAt ?? Number.POSITIVE_INFINITY) - (a.closedAt ?? Number.POSITIVE_INFINITY));
    const offset = Number(q.cursor ?? 0) || 0;
    const limit = Math.min(Math.max(q.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const page = filtered.slice(offset, offset + limit);
    const next = offset + limit;
    return { trades: page, nextCursor: next < filtered.length ? String(next) : null, empty: data.empty };
  }

  function leaksOf(data: AccountData, range: Range): Leak[] {
    const now = deps.now(data.account);
    return computeLeaks(
      filterRange(data.trades, range, now),
      filterFundingRange(data.attribution.unattributedFunding, range, now),
    );
  }

  function leakEvidence(data: AccountData, id: LeakId, range: Range): Set<string> {
    return new Set(leaksOf(data, range).find((l) => l.id === id)?.evidenceTradeIds ?? []);
  }

  async function getLeaks(account: Address, range: Range): Promise<Leak[]> {
    return leaksOf(await getAccountData(account), range);
  }

  async function getPositions(account: Address): Promise<PositionView[]> {
    const data = await getAccountData(account);
    // Without the collateral read there are no active pools, and "no open positions" would be a lie.
    if (data.collateralRaw === null) throw new ChainUnavailableError("collateral read failed");
    let positions: OpenPosition[];
    try {
      positions = await deps.fetchOpenPositions(account, data);
    } catch (error) {
      throw new ChainUnavailableError(error);
    }
    // Not cached: arming or cancelling a stop must show on the next read.
    const stops = (await deps.fetchPerplogStops?.(account)) ?? [];
    return positions.map((position) => withPerplogStop(position, stops));
  }

  return { getAccountData, getHealth, getTrades, getLeaks, getPositions };
}

export type AccountService = ReturnType<typeof createAccountService>;
