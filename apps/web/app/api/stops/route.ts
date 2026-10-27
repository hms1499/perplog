import { isTriggered, normalizeAddress } from "@perplog/core";
import { getSession, insertStop } from "@perplog/db";
import { z } from "zod";
import { chain } from "@/lib/chain";
import { getDb } from "@/lib/db";
import { handleRoute, json } from "@/lib/json";
import { checkOrigin, limitPost, sessionId } from "@/lib/session";
import { linkedOf, toStopView } from "@/lib/stops";

const POOL_NOT_LINKED_MESSAGE =
  "PerpLog's bot is not linked for this market. In the dreamDEX app, open your wallet → Link a bot → tick Perps and paste the same bot address again.";

/** Raw decimal integers only (no sign, fraction or exponent); 78 digits is the column's width. */
const rawAmount = z.string().regex(/^[0-9]{1,78}$/);

const Body = z
  .object({
    pool: z.string().min(1).max(100),
    triggerPrice: rawAmount,
    qtyMode: z.enum(["entire", "fixed"]),
    qtyRaw: rawAmount.optional(),
  })
  .refine((b) => b.qtyMode === "entire" || b.qtyRaw !== undefined);

const fail = (error: string, status: number, extra: object = {}) => json({ error, ...extra }, { status });

const ceilTo = (value: bigint, step: bigint) => ((value + step - 1n) / step) * step;
const floorTo = (value: bigint, step: bigint) => (value / step) * step;

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

    const raw: unknown = await request.json().catch(() => undefined);
    const parsed = Body.safeParse(raw);
    const pool = parsed.success ? normalizeAddress(parsed.data.pool) : null;
    if (!parsed.success || !pool) return fail("invalid_input", 400);
    const input = parsed.data;
    const requestedTrigger = BigInt(input.triggerPrice);
    if (requestedTrigger === 0n) return fail("invalid_input", 400);
    const requestedQty = input.qtyMode === "fixed" ? BigInt(input.qtyRaw ?? "0") : null;
    if (requestedQty === 0n) return fail("invalid_input", 400);

    const market = (await chain.markets()).find((m) => m.pool === pool);
    if (!market) return fail("unknown_pool", 400);

    const size = await chain.readPositionSize(linked.account, pool);
    if (size === 0n) return fail("no_position", 409);
    const side = size > 0n ? "long" : "short";
    const absSize = size > 0n ? size : -size;

    const granted = await chain.grantedPools(linked.account, linked.botAddress, [pool]);
    if (granted.length === 0) return fail("pool_not_linked", 409, { message: POOL_NOT_LINKED_MESSAGE });

    // Snap to the side that arms the stop earlier, never later than the user asked.
    const triggerPrice =
      side === "long"
        ? ceilTo(requestedTrigger, market.tickSize)
        : floorTo(requestedTrigger, market.tickSize);
    const mark = (await chain.readMark(pool)).price;
    if (isTriggered(side, triggerPrice, mark)) return fail("trigger_wrong_side", 400);

    let qtyRaw: bigint | null = null;
    if (requestedQty !== null) {
      qtyRaw = floorTo(requestedQty, market.lotSize);
      if (qtyRaw < market.minQuantity || qtyRaw > absSize) return fail("bad_quantity", 400);
    }

    const row = await insertStop(db, {
      account: linked.account,
      pool,
      botKeyId: linked.botKeyId,
      positionSide: side,
      triggerPrice,
      triggerOp: side === "long" ? "lte" : "gte",
      qtyMode: input.qtyMode,
      qtyRaw,
      status: "armed",
    });
    return json({ stop: toStopView(row) }, { status: 201 });
  });
}
