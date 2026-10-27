import { ACTIVE_STOP_STATUSES } from "@perplog/core";
import { getSession, listAccountStops, transitionStop } from "@perplog/db";
import { getDb } from "@/lib/db";
import { handleRoute, json } from "@/lib/json";
import { checkOrigin, sessionId } from "@/lib/session";
import { linkedOf } from "@/lib/stops";

const fail = (error: string, status: number) => json({ error }, { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const badOrigin = checkOrigin(request);
    if (badOrigin) return badOrigin;
    const db = getDb();
    if (!db) return fail("db_unavailable", 503);

    const sid = sessionId(request);
    const session = sid ? await getSession(db, sid) : null;
    if (!session) return fail("no_session", 401);
    const linked = linkedOf(session);
    if (!linked) return fail("not_linked", 403);

    const { id } = await ctx.params;
    // Listed by the session's own account, so another account's stop is indistinguishable from an absent one.
    const mine = UUID.test(id)
      ? (await listAccountStops(db, linked.account, [...ACTIVE_STOP_STATUSES])).find(
          (s) => s.id === id.toLowerCase(),
        )
      : undefined;
    if (!mine) return fail("not_found", 404);

    // Compare-and-set: a stop the worker already triggered must not be cancelled out from under it.
    const cancelled = await transitionStop(db, mine.id, ["armed", "paused"], "cancelled");
    return cancelled ? json({ ok: true }) : fail("stop_in_progress", 409);
  });
}
