import { isoWeekStart, weekStartSec } from "@perplog/core";
import { handleRoute, json } from "@/lib/json";
import { parseAddress } from "@/lib/request";
import { accountService } from "@/lib/service";

/** One ISO week's report (`?week=YYYY-MM-DD`, a Monday; default: this week). */
export async function GET(request: Request, ctx: { params: Promise<{ address: string }> }) {
  return handleRoute(async () => {
    const address = await parseAddress(ctx.params);
    if (!address.ok) return address.response;
    const week = new URL(request.url).searchParams.get("week") ?? isoWeekStart(Date.now() / 1000);
    if (weekStartSec(week) === null) return json({ error: "invalid_week" }, { status: 400 });
    return json(await accountService.getWeekly(address.value, week));
  });
}
