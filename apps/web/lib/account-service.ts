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
  type MarketInfo,
  type OpenPosition,
  type Range,
  type ReconcileResult,
  reconcile,
  reconstructTrades,
  type Side,
} from "@perplog/core";
import { LRUCache } from "lru-cache";

export interface AccountData {
  account: Address;
  markets: Map<Address, MarketInfo>;
  history: AccountHistory;
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
  /** Unix seconds. */
  now(): number;
}

export type HealthResponse = HealthSummary & { empty: boolean; truncated: boolean; asOfTimestamp: number };

export interface TradesQuery {
  range: Range;
  market?: Address;
  exit?: ExitType;
  side?: Side;
  cursor?: string;
  limit?: number;
}

const MARKETS_TTL_SEC = 600;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface Entry<T> {
  value: Promise<T>;
  expiresAt: number;
}

export function createAccountService(deps: AccountServiceDeps, cacheTtlMs = 60_000) {
  const ttlSec = cacheTtlMs / 1000;
  const accounts = new LRUCache<Address, Entry<AccountData>>({ max: 500 });
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
    const [history, collateral] = await Promise.all([
      deps.fetchHistory(account, new Set(marketMap.keys())),
      deps.fetchCollateral(account),
    ]);
    const attribution = attributeCosts(
      reconstructTrades(account, history.changes),
      history.funding,
      history.fees,
    );
    const trades = enrichTrades(attribution, history, marketMap, history.asOfTimestamp);
    return {
      account,
      markets: marketMap,
      history,
      collateralRaw: collateral.collateralRaw,
      activePools: collateral.activePools,
      attribution,
      trades,
      reconcile: history.truncated ? null : reconcile(history, collateral.collateralRaw),
      asOfTimestamp: history.asOfTimestamp,
      empty: history.changes.length === 0,
    };
  }

  async function getAccountData(account: Address): Promise<AccountData> {
    const entry = cached(accounts.get(account), ttlSec, () => loadAccount(account));
    accounts.set(account, entry);
    return entry.value;
  }

  async function getHealth(account: Address, range: Range): Promise<HealthResponse> {
    const data = await getAccountData(account);
    const summary = buildHealthSummary({
      trades: data.trades,
      unattributedFunding: data.attribution.unattributedFunding,
      range,
      nowSec: deps.now(),
      reconcile: data.reconcile,
    });
    return {
      ...summary,
      empty: data.empty,
      truncated: data.history.truncated,
      asOfTimestamp: data.asOfTimestamp,
    };
  }

  async function getTrades(
    account: Address,
    q: TradesQuery,
  ): Promise<{ trades: EnrichedTrade[]; nextCursor: string | null }> {
    const data = await getAccountData(account);
    const inRange = filterRange(data.trades, q.range, deps.now());
    const open = q.range === "all" ? data.trades.filter((t) => t.closedAt === null) : [];
    const filtered = [...open, ...inRange]
      .filter((t) => !q.market || t.pool === q.market)
      .filter((t) => !q.exit || t.exitType === q.exit)
      .filter((t) => !q.side || t.side === q.side)
      .sort((a, b) => (b.closedAt ?? Number.POSITIVE_INFINITY) - (a.closedAt ?? Number.POSITIVE_INFINITY));
    const offset = Number(q.cursor ?? 0) || 0;
    const limit = Math.min(Math.max(q.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const page = filtered.slice(offset, offset + limit);
    const next = offset + limit;
    return { trades: page, nextCursor: next < filtered.length ? String(next) : null };
  }

  async function getLeaks(account: Address, range: Range): Promise<Leak[]> {
    const data = await getAccountData(account);
    const now = deps.now();
    return computeLeaks(
      filterRange(data.trades, range, now),
      filterFundingRange(data.attribution.unattributedFunding, range, now),
    );
  }

  async function getPositions(account: Address): Promise<OpenPosition[]> {
    const data = await getAccountData(account);
    return deps.fetchOpenPositions(account, data);
  }

  return { getAccountData, getHealth, getTrades, getLeaks, getPositions };
}

export type AccountService = ReturnType<typeof createAccountService>;
