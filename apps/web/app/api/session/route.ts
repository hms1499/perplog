import { normalizeAddress } from "@perplog/core";
import {
  bindBotKey,
  bindSession,
  createBotKeyRequest,
  createSession,
  type Db,
  getSession,
  upsertWatch,
} from "@perplog/db";
import { chain } from "@/lib/chain";
import { getDb } from "@/lib/db";
import { handleRoute, json } from "@/lib/json";
import { checkOrigin, limitPost, sessionId, setSessionCookie } from "@/lib/session";

type SessionView = NonNullable<Awaited<ReturnType<typeof getSession>>>;

const dbUnavailable = () => json({ error: "db_unavailable" }, { status: 503 });

/** Bot key state as the client sees it; `requested` means the worker has not minted the address yet. */
function summary(session: SessionView) {
  const key = session.botKey;
  return {
    status: key?.status === "linked" ? "linked" : key?.status === "pending" ? "pending" : "requested",
    botAddress: key?.address ?? null,
  };
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const badOrigin = checkOrigin(request);
    if (badOrigin) return badOrigin;
    const db = getDb();
    if (!db) return dbUnavailable();
    const limited = await limitPost(db, request);
    if (limited) return limited;

    const existingId = sessionId(request);
    const existing = existingId ? await getSession(db, existingId) : null;
    if (existing) return json(summary(existing), { status: 201 });

    const key = await createBotKeyRequest(db);
    const created = await createSession(db, key.id);
    const body = { status: "requested", botAddress: null };
    return setSessionCookie(json(body, { status: 201 }), created.id);
  });
}

/** Spec 4.3: a pending key links to `account` once the bot holds an on-chain grant for it. */
async function tryBind(db: Db, session: SessionView, account: string): Promise<void> {
  const key = session.botKey;
  if (key?.status !== "pending" || !key.address) return;
  const owner = normalizeAddress(account);
  if (!owner) return;
  const granted = await chain.grantedPools(owner, key.address, await chain.perpPools());
  if (granted.length === 0) return;
  // False means another request linked this key first; the re-read below reports whatever won.
  if (await bindBotKey(db, key.id, owner, granted)) {
    await bindSession(db, session.id, owner);
    await upsertWatch(db, owner, "session");
  }
}

export async function GET(request: Request) {
  return handleRoute(async () => {
    const db = getDb();
    if (!db) return dbUnavailable();
    const id = sessionId(request);
    const session = id ? await getSession(db, id) : null;
    if (!session) return json({ error: "no_session" }, { status: 401 });

    const raw = new URL(request.url).searchParams.get("account");
    if (raw !== null && !normalizeAddress(raw)) return json({ error: "invalid_address" }, { status: 400 });
    if (raw !== null) await tryBind(db, session, raw);

    const fresh = (await getSession(db, session.id)) ?? session;
    const key = fresh.botKey;
    const linked = key?.status === "linked";
    const linkedPools = linked ? key.linkedPools : [];
    const [perpPools, markets] = await Promise.all([chain.perpPools(), chain.markets()]);
    return json({
      ...summary(fresh),
      account: linked ? key.account : null,
      linkedPools,
      missingPools: linked ? perpPools.filter((p) => !linkedPools.includes(p)) : [],
      // Display names for the wizard's checklist (additive to the contract).
      symbols: Object.fromEntries(markets.map((m) => [m.pool, m.symbol])),
    });
  });
}
