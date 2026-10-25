import { IndexerError } from "@perplog/chain";

const replacer = (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);

export function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data, replacer), {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
}

export async function handleRoute(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof IndexerError) return json({ error: "indexer_unavailable" }, { status: 503 });
    console.error(error);
    return json({ error: "internal" }, { status: 500 });
  }
}
