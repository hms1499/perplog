import { normalizeAddress } from "@perplog/core";
import { listAlertsSince } from "@perplog/db";
import { toAlertView } from "@/lib/alerts";
import { chain } from "@/lib/chain";
import { getDb } from "@/lib/db";
import { handleRoute, json } from "@/lib/json";

const MAX_ALERTS = 50;

/** GET /api/alerts?account=0x…&since=<ms>: up to 50 alerts from `since`, oldest first. */
export async function GET(request: Request) {
  return handleRoute(async () => {
    const db = getDb();
    if (!db) return json({ error: "db_unavailable" }, { status: 503 });
    const params = new URL(request.url).searchParams;
    const account = normalizeAddress(params.get("account") ?? "");
    const sinceParam = params.get("since") ?? "0";
    const since = /^[0-9]{1,15}$/.test(sinceParam) ? Number(sinceParam) : null;
    if (!account || since === null) return json({ error: "invalid_input" }, { status: 400 });
    const rows = await listAlertsSince(db, account, since, MAX_ALERTS);
    // Symbols are a display nicety: an unreadable market list must not hide the alerts.
    const markets = rows.some((r) => r.pool) ? await chain.markets().catch(() => []) : [];
    const symbols = new Map(markets.map((m) => [m.pool.toLowerCase(), m.symbol]));
    return json({ alerts: rows.map((r) => toAlertView(r, symbols)) });
  });
}
