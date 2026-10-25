import { z } from "zod";
import { handleRoute, json } from "@/lib/json";
import { parseAddress, parseQuery, rangeSchema } from "@/lib/request";
import { accountService } from "@/lib/service";

const query = z.object({ range: rangeSchema });

export async function GET(request: Request, ctx: { params: Promise<{ address: string }> }) {
  return handleRoute(async () => {
    const address = await parseAddress(ctx.params);
    if (!address.ok) return address.response;
    const q = parseQuery(request, query);
    if (!q.ok) return q.response;
    return json(await accountService.getHealth(address.value, q.value.range));
  });
}
