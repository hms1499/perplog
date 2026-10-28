import { chain } from "@/lib/chain";
import { handleRoute, json } from "@/lib/json";

/** The perp market list (pools, decimals, tick and lot sizes) for the Plan form. Read-only, no DB. */
export async function GET() {
  return handleRoute(async () => json(await chain.markets()));
}
