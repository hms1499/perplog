import { handleRoute, json } from "@/lib/json";
import { parseAddress } from "@/lib/request";
import { accountService } from "@/lib/service";

export async function GET(_request: Request, ctx: { params: Promise<{ address: string }> }) {
  return handleRoute(async () => {
    const address = await parseAddress(ctx.params);
    if (!address.ok) return address.response;
    return json(await accountService.getPositions(address.value));
  });
}
