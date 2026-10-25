import { type Address, normalizeAddress } from "@perplog/core";
import { z } from "zod";
import { json } from "./json";

export const rangeSchema = z.enum(["7d", "30d", "all"]).default("7d");

export type Parsed<T> = { ok: true; value: T } | { ok: false; response: Response };

export async function parseAddress(params: Promise<{ address: string }>): Promise<Parsed<Address>> {
  const { address } = await params;
  const normalized = normalizeAddress(decodeURIComponent(address));
  return normalized
    ? { ok: true, value: normalized }
    : { ok: false, response: json({ error: "invalid_address" }, { status: 400 }) };
}

export function parseQuery<T>(request: Request, schema: z.ZodType<T>): Parsed<T> {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const result = schema.safeParse(params);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, response: json({ error: "invalid_query", issues: result.error.issues }, { status: 400 }) };
}
