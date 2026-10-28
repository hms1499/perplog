import { HIDEKI } from "@perplog/chain";
import { normalizeAddress } from "@perplog/core";
import { listEvidence, medianStopLatencyMs } from "@perplog/db";
import { chain } from "@/lib/chain";
import { getDb } from "@/lib/db";
import { handleRoute, json } from "@/lib/json";

/** Every PerpLog order with a tx hash, newest first (for /evidence). Public: no keys, no session. */
export async function GET(request: Request) {
  return handleRoute(async () => {
    // Read the request first: it marks the route dynamic before the build would open a database connection.
    const raw = new URL(request.url).searchParams.get("account");
    const db = getDb();
    if (!db) return json({ error: "db_unavailable" }, { status: 503 });
    const account = raw === null ? undefined : normalizeAddress(raw);
    if (account === null) return json({ error: "invalid_address" }, { status: 400 });

    const [rows, medianMs, markets] = await Promise.all([
      listEvidence(db, { account }),
      medianStopLatencyMs(db),
      chain.markets().catch(() => []),
    ]);
    const byPool = new Map(markets.map((m) => [m.pool, m]));
    const entries = rows.filter((r) => r.kind === "entry").length;
    return json({
      rows: rows.map((r) => ({
        kind: r.kind,
        status: r.status,
        account: r.account,
        pool: r.pool,
        symbol: byPool.get(r.pool)?.symbol ?? null,
        baseDecimals: byPool.get(r.pool)?.baseDecimals ?? null,
        isBid: r.isBid,
        filledRaw: r.filledRaw,
        avgPrice: r.avgPrice,
        txHash: r.txHash,
        explorerUrl: r.txHash ? HIDEKI.explorerTx(r.txHash) : null,
        createdAt: r.createdAt.toISOString(),
      })),
      totals: {
        transactions: rows.length,
        entries,
        stopCloses: rows.length - entries,
        medianStopLatencyMs: medianMs,
      },
    });
  });
}
