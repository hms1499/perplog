import { normalizeAddress } from "@perplog/core";
import { getSession, upsertWatch } from "@perplog/db";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { handleRoute, json } from "@/lib/json";
import { checkOrigin, limitPost, sessionId } from "@/lib/session";

const Body = z.object({ account: z.string().min(1).max(100) });

/** POST /api/watch { account }: the worker's AlertEngine starts watching this account's positions. */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const badOrigin = checkOrigin(request);
    if (badOrigin) return badOrigin;
    const db = getDb();
    if (!db) return json({ error: "db_unavailable" }, { status: 503 });

    // Only a session id that exists may key the rate limit, otherwise the IP does.
    const id = sessionId(request);
    const session = id ? await getSession(db, id) : null;
    const limited = await limitPost(db, request, session?.id ?? null);
    if (limited) return limited;

    const parsed = Body.safeParse(await request.json().catch(() => undefined));
    const account = parsed.success ? normalizeAddress(parsed.data.account) : null;
    if (!account) return json({ error: "invalid_address" }, { status: 400 });
    await upsertWatch(db, account, "watch");
    return json({ watching: true });
  });
}
