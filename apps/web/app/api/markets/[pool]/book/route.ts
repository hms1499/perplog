import { normalizeAddress } from "@perplog/core";
import { chain } from "@/lib/chain";
import { handleRoute, json } from "@/lib/json";

/** Best bid and ask for one market, for the Plan ticket's book line (spec §6.3). Read-only, no DB, no session. */
export async function GET(_request: Request, { params }: { params: Promise<{ pool: string }> }) {
  return handleRoute(async () => {
    const pool = normalizeAddress((await params).pool);
    const market = pool ? (await chain.markets()).find((m) => m.pool === pool) : undefined;
    if (!market) return json({ error: "unknown_pool" }, { status: 400 });
    const top = await chain.bookTop(market.pool);
    return json(top, { headers: { "cache-control": "no-store" } });
  });
}
