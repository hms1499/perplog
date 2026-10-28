import { createPlanWithEntry, getSession } from "@perplog/db";
import { chain } from "@/lib/chain";
import { getDb } from "@/lib/db";
import { handleRoute, json } from "@/lib/json";
import { toPlanView } from "@/lib/plans";
import { parseQuoteBody, quoteEntry } from "@/lib/quote";
import { checkOrigin, limitPost, sessionId } from "@/lib/session";
import { linkedOf, POOL_NOT_LINKED_MESSAGE } from "@/lib/stops";

const fail = (error: string, status: number, extra: object = {}) => json({ error, ...extra }, { status });

/**
 * Places a plan: the server re-quotes from live reads (client numbers are never trusted) and queues ONE entry for
 * the worker, which sends it at most once and arms the plan's stop on the fill.
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const badOrigin = checkOrigin(request);
    if (badOrigin) return badOrigin;
    const db = getDb();
    if (!db) return fail("db_unavailable", 503);

    // Resolve the session first: only an id that exists may key the rate limit, otherwise the IP does.
    const id = sessionId(request);
    const session = id ? await getSession(db, id) : null;
    const limited = await limitPost(db, request, session?.id ?? null);
    if (limited) return limited;
    if (!session) return fail("no_session", 401);
    const linked = linkedOf(session);
    if (!linked) return fail("not_linked", 403);

    const raw = (await request.json().catch(() => undefined)) as { confirm?: unknown } | undefined;
    const input = raw?.confirm === true ? parseQuoteBody(raw) : null;
    if (!input) return fail("invalid_input", 400);
    if (input.account !== linked.account) return fail("account_mismatch", 403);

    const granted = await chain.grantedPools(linked.account, linked.botAddress, [input.pool]);
    if (granted.length === 0) return fail("pool_not_linked", 409, { message: POOL_NOT_LINKED_MESSAGE });
    // A plan stop closes the entire position, so it may only be armed on a position the plan opened itself.
    if ((await chain.readPositionSize(linked.account, input.pool)) !== 0n) return fail("position_open", 409);

    const quote = await quoteEntry(input);
    if (!quote.ok) return fail(quote.error, 400);
    const created = await createPlanWithEntry(db, {
      account: linked.account,
      pool: input.pool,
      botKeyId: linked.botKeyId,
      side: input.side,
      riskRaw: input.riskRaw,
      refPrice: quote.refPrice,
      stopPrice: quote.stopPrice,
      qtyRaw: quote.qtyRaw,
      priceBound: quote.priceBound,
      leverageEstBps: quote.leverageEstBps,
      liqPriceEst: quote.liqPriceEst,
    });
    if (!created) return fail("plan_pending", 409);
    return json({ plan: toPlanView(created.plan, null) }, { status: 201 });
  });
}
