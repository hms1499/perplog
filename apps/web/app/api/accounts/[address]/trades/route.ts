import { type Address, normalizeAddress } from "@perplog/core";
import { z } from "zod";
import { handleRoute, json } from "@/lib/json";
import { parseAddress, parseQuery, rangeSchema } from "@/lib/request";
import { accountService } from "@/lib/service";

const query = z.object({
  range: rangeSchema,
  market: z
    .string()
    .transform((v, ctx) => {
      const a = normalizeAddress(v);
      if (!a) ctx.addIssue({ code: "custom", message: "invalid market" });
      return a as Address;
    })
    .optional(),
  exit: z.enum(["LIQUIDATED", "NATIVE_STOP", "PERPLOG_STOP", "MANUAL", "OPEN"]).optional(),
  side: z.enum(["long", "short"]).optional(),
  cursor: z.string().regex(/^\d+$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(request: Request, ctx: { params: Promise<{ address: string }> }) {
  return handleRoute(async () => {
    const address = await parseAddress(ctx.params);
    if (!address.ok) return address.response;
    const q = parseQuery(request, query);
    if (!q.ok) return q.response;
    return json(await accountService.getTrades(address.value, q.value));
  });
}
