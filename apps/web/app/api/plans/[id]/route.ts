import { getExecution, getPlan, getSession } from "@perplog/db";
import { getDb } from "@/lib/db";
import { handleRoute, json } from "@/lib/json";
import { toPlanView } from "@/lib/plans";
import { sessionId } from "@/lib/session";
import { linkedOf } from "@/lib/stops";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => json({ error: "not_found" }, { status: 404 });

/** A plan's status for its owner; anyone else (or no session) gets the same 404 as an absent plan. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const db = getDb();
    if (!db) return json({ error: "db_unavailable" }, { status: 503 });
    const { id } = await ctx.params;
    const sid = sessionId(request);
    const session = sid ? await getSession(db, sid) : null;
    const linked = session ? linkedOf(session) : null;
    if (!linked || !UUID.test(id)) return notFound();

    const plan = await getPlan(db, id.toLowerCase());
    if (!plan || plan.account !== linked.account) return notFound();
    const entry = plan.entryExecutionId ? await getExecution(db, plan.entryExecutionId) : null;
    return json({ plan: toPlanView(plan, entry?.txHash ?? null) });
  });
}
