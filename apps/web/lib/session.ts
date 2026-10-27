import { type Db, hitRateLimit } from "@perplog/db";
import { json } from "./json";

export const SESSION_COOKIE = "perplog_session";
export const POSTS_PER_MINUTE = 10;
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** CSRF guard for state-changing requests: the Origin header must equal the request's own origin. */
export function checkOrigin(req: Request): Response | null {
  const origin = req.headers.get("origin");
  return origin !== null && origin === new URL(req.url).origin
    ? null
    : json({ error: "bad_origin" }, { status: 403 });
}

/** The session id from the cookie, or null when absent or not a UUID (so it is safe to query with). */
export function sessionId(req: Request): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return UUID.test(value) ? value.toLowerCase() : null;
  }
  return null;
}

export function setSessionCookie(res: Response, id: string): Response {
  const attrs = [
    `${SESSION_COOKIE}=${id}`,
    "Path=/",
    `Max-Age=${MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV === "production") attrs.push("Secure");
  res.headers.append("set-cookie", attrs.join("; "));
  return res;
}

/** 10 POSTs per minute per session (per client IP without one), counted in Postgres. */
export async function limitPost(db: Db, req: Request): Promise<Response | null> {
  const id = sessionId(req);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const allowed = await hitRateLimit(db, id ?? `ip:${ip}`, POSTS_PER_MINUTE, new Date());
  return allowed ? null : json({ error: "rate_limited" }, { status: 429 });
}
