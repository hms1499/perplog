import { handleRoute, json } from "@/lib/json";
import { parseQuoteBody, quoteEntry } from "@/lib/quote";

/** Sizing preview (spec §6.6): live reads, no session, no DB, no side effects. */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const input = parseQuoteBody(await request.json().catch(() => undefined));
    if (!input) return json({ error: "invalid_input" }, { status: 400 });
    const quote = await quoteEntry(input);
    if (!quote.ok) return json({ error: quote.error }, { status: 400 });
    const { ok: _ok, ...view } = quote;
    return json(view);
  });
}
