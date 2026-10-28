import { IndexerError } from "@perplog/chain";
import { unstable_rethrow } from "next/navigation";
import { ChainUnavailableError } from "./account-service";

const replacer = (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);

export function json(data: unknown, init?: ResponseInit): Response {
  // `new Headers` accepts every HeadersInit shape; spreading a Headers instance would drop its entries.
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return new Response(JSON.stringify(data, replacer), { ...init, headers });
}

export async function handleRoute(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    // Next signals "this route is dynamic" during the build by throwing; that is control flow, not a failure.
    unstable_rethrow(error);
    if (error instanceof IndexerError) return json({ error: "indexer_unavailable" }, { status: 503 });
    if (error instanceof ChainUnavailableError) {
      console.error(error);
      return json({ error: "chain_unavailable" }, { status: 503 });
    }
    console.error(error);
    return json({ error: "internal" }, { status: 500 });
  }
}
