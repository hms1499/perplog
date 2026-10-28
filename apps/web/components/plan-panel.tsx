"use client";

import {
  type Address,
  formatAmount,
  type MarketInfo,
  PRICE_DECIMALS,
  parseAmount,
  stepDecimals,
} from "@perplog/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError, getJson, type Wire } from "@/lib/api";
import { useProtectionAvailable, useSessionState } from "@/lib/use-protection";
import { ErrorState } from "./error-state";
import { LinkWizard } from "./link-wizard";
import { BreakdownRow, Button, Field, Label, Num, Panel, Segmented, StepTracker, WarnBox } from "./ui";

type Side = "long" | "short";

interface QuoteView {
  qtyRaw: string;
  refPrice: string;
  stopPrice: string;
  priceBound: string;
  notionalRaw: string;
  effectiveRiskRaw: string;
  capped: boolean;
  liqPriceEst: string | null;
  leverageEstBps: string | null;
  warnings: string[];
}

interface PlanView {
  id: string;
  status: "pending_entry" | "entered" | "partially_entered" | "entry_failed";
  stopId: string | null;
  txHash: string | null;
}

const QUOTE_ERRORS: Record<string, (side: Side) => string> = {
  no_liquidity: (side) => `No resting ${side === "long" ? "asks" : "bids"} on the book right now.`,
  stop_wrong_side: (side) =>
    side === "long"
      ? "Your stop must be below the entry price for a long."
      : "Your stop must be above the entry price for a short.",
  risk_too_small: () => "That risk is too small for one lot on this market.",
  stop_beyond_liquidation: () => "Stop is beyond your liquidation price; you would be liquidated first",
  not_priceable: () => "The market's mark price is stale right now; try again in a moment.",
  unknown_pool: () => "Unknown market.",
  invalid_input: () => "Enter a positive risk and stop price.",
};

const PLACE_ERRORS: Record<string, string> = {
  plan_pending: "A plan on this market is already being entered.",
  position_open: "You already have a position on this market. Plan & Place only opens new positions.",
  account_mismatch: "This browser's PerpLog bot is linked to another account.",
  rate_limited: "Too many requests; wait a minute.",
};

class PlanError extends Error {
  constructor(
    readonly code: string,
    readonly detail: string | null,
  ) {
    super(code);
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new PlanError(json.error ?? "unknown", json.message ?? null);
  return json as T;
}

/** `value`, but only after it has been stable for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

export function PlanPanel({ address }: { address: Address }) {
  const markets = useQuery({
    queryKey: ["markets"],
    queryFn: () => getJson<Wire<MarketInfo>[]>("/api/markets"),
    staleTime: 10 * 60_000,
  });
  const available = useProtectionAvailable();
  const session = useSessionState(available);
  const [pool, setPool] = useState<string | null>(null);
  const [side, setSide] = useState<Side>("long");
  const [risk, setRisk] = useState("");
  const [stop, setStop] = useState("");
  const [planId, setPlanId] = useState<string | null>(null);

  const market = markets.data?.find((m) => m.pool === pool) ?? markets.data?.[0] ?? null;
  const riskRaw = parseAmount(risk, 18);
  const stopRaw = parseAmount(stop, PRICE_DECIMALS);
  const input =
    market && riskRaw && stopRaw
      ? {
          account: address,
          pool: market.pool,
          side,
          riskRaw: riskRaw.toString(),
          stopPrice: stopRaw.toString(),
        }
      : null;
  // Debounced by value: `input` is a new object on every render.
  const debouncedKey = useDebounced(input ? JSON.stringify(input) : null, 400);
  const debounced = debouncedKey ? (JSON.parse(debouncedKey) as NonNullable<typeof input>) : null;

  const quote = useQuery({
    queryKey: ["plan-quote", debouncedKey],
    queryFn: () => postJson<QuoteView>("/api/plans/quote", debounced),
    enabled: debounced !== null,
    retry: false,
    staleTime: 5_000,
  });

  const place = useMutation({
    // The previewed input, never the one still being typed: what is placed is what was shown.
    mutationFn: () => postJson<{ plan: PlanView }>("/api/plans", { ...debounced, confirm: true }),
    onSuccess: (res) => setPlanId(res.plan.id),
  });

  const plan = useQuery({
    queryKey: ["plan", planId],
    queryFn: async () => (await getJson<{ plan: PlanView }>(`/api/plans/${planId}`)).plan,
    enabled: planId !== null,
    refetchInterval: (q) => (q.state.data && q.state.data.status !== "pending_entry" ? false : 2_000),
  });

  if (markets.isPending) return <p className="py-10 text-muted">Loading markets…</p>;
  if (markets.error || !market) {
    return (
      <ErrorState
        error={markets.error ?? new ApiError(503, "no_markets")}
        onRetry={() => markets.refetch()}
      />
    );
  }

  const sizeDp = stepDecimals(BigInt(market.lotSize), market.baseDecimals);
  const priceDp = stepDecimals(BigInt(market.tickSize), PRICE_DECIMALS);
  const price = (raw: string) => formatAmount(BigInt(raw), PRICE_DECIMALS, priceDp);
  const base = market.symbol.replace(/-PERP$/i, "");
  const linkedAccount =
    session.data?.status === "linked" ? (session.data.account?.toLowerCase() ?? null) : null;
  const q = quote.data;
  const quoteError = quote.error instanceof PlanError ? quote.error.code : quote.error ? "unknown" : null;

  return (
    <section className="grid items-start gap-3 py-6 lg:grid-cols-[380px_1fr]">
      <Panel className="grid gap-3.5">
        <div>
          <label htmlFor="plan-market" className="text-muted text-xs uppercase tracking-[0.3px]">
            Market
          </label>
          <select
            id="plan-market"
            value={market.pool}
            onChange={(e) => setPool(e.target.value)}
            className="mt-1.5 h-[42px] w-full rounded-lg border border-line bg-field px-3 font-semibold text-head"
          >
            {markets.data?.map((m) => (
              <option key={m.pool} value={m.pool}>
                {m.symbol}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>Side</Label>
          <div className="mt-1.5">
            <Segmented
              label="Side"
              tone="side"
              value={side}
              onChange={setSide}
              options={[
                { value: "long", label: "Long" },
                { value: "short", label: "Short" },
              ]}
            />
          </div>
        </div>
        <Field
          id="plan-risk"
          label="Max loss if the stop hits"
          unit="USDso"
          inputMode="decimal"
          placeholder="25"
          value={risk}
          onChange={(e) => setRisk(e.target.value)}
          invalid={risk !== "" && !riskRaw}
        />
        <Field
          id="plan-stop"
          label="Stop price"
          unit="USDso"
          inputMode="decimal"
          placeholder={side === "long" ? "below the ask" : "above the bid"}
          value={stop}
          onChange={(e) => setStop(e.target.value)}
          invalid={stop !== "" && !stopRaw}
          hint={side === "long" ? "Below the current ask." : "Above the current bid."}
        />
      </Panel>

      <Panel className="flex min-h-[360px] flex-col">
        <div data-testid="plan-quote">
          <Label>PerpLog sizes it for you</Label>
          {!input ? (
            <p className="mt-3 text-muted">
              Enter how much you are willing to lose and where your stop goes.
            </p>
          ) : quoteError ? (
            <div className="mt-3">
              <WarnBox tone="loss">
                {(QUOTE_ERRORS[quoteError] ?? (() => "Could not read the market. Try again."))(side)}
              </WarnBox>
            </div>
          ) : !q ? (
            <p className="mt-3 text-muted">Reading the book…</p>
          ) : (
            <>
              <div className="mt-1.5 flex items-baseline gap-2.5">
                <Num
                  text={formatAmount(BigInt(q.qtyRaw), market.baseDecimals, sizeDp)}
                  className="font-semibold text-[44px] text-head tracking-[-1px]"
                />
                <span className="text-muted">
                  {base} · {side}
                </span>
              </div>
              <div className="mt-2.5">
                <BreakdownRow
                  label="Notional"
                  value={<Num text={`${formatAmount(BigInt(q.notionalRaw), 18, 2)} USDso`} />}
                />
                <BreakdownRow label="Entry (IOC, worst price)" value={<Num text={price(q.priceBound)} />} />
                <BreakdownRow
                  label="Est. liquidation price"
                  value={<Num text={q.liqPriceEst ? price(q.liqPriceEst) : "—"} />}
                />
                <BreakdownRow
                  label="Est. leverage"
                  value={
                    <Num
                      text={q.leverageEstBps ? `${(Number(q.leverageEstBps) / 10_000).toFixed(1)}×` : "—"}
                    />
                  }
                />
                <BreakdownRow
                  label="Risk if the stop hits"
                  value={
                    <Num tone="loss" text={`−${formatAmount(BigInt(q.effectiveRiskRaw), 18, 2)} USDso`} />
                  }
                />
              </div>
              {q.warnings.map((w) => (
                <div key={w} className="mt-2.5">
                  <WarnBox>{w}</WarnBox>
                </div>
              ))}
            </>
          )}
        </div>
        <div className="flex-1" />

        {available && (
          <div className="mt-3.5">
            {session.isPending ? (
              <p className="text-muted">Checking PerpLog's link…</p>
            ) : linkedAccount === address.toLowerCase() ? (
              <PlaceBlock
                canPlace={
                  Boolean(q) &&
                  !quoteError &&
                  !quote.isFetching &&
                  // The preview must be of what is typed now.
                  (input ? JSON.stringify(input) : null) === debouncedKey &&
                  !place.isPending &&
                  !(plan.data?.status === "pending_entry")
                }
                summary={
                  q
                    ? `${side} ${formatAmount(BigInt(q.qtyRaw), market.baseDecimals, sizeDp)} ${base} · stop ${price(q.stopPrice)}`
                    : null
                }
                onPlace={() => place.mutate()}
                placing={place.isPending}
                placeError={
                  place.error instanceof PlanError
                    ? (place.error.detail ??
                      PLACE_ERRORS[place.error.code] ??
                      "Could not place the order. Try again.")
                    : null
                }
                plan={
                  planId
                    ? (plan.data ?? { id: planId, status: "pending_entry", stopId: null, txHash: null })
                    : null
                }
              />
            ) : linkedAccount !== null ? (
              <WarnBox>
                This browser's PerpLog bot is linked to another account. Open that account to place a plan.
              </WarnBox>
            ) : (
              <LinkWizard account={address} onLinked={() => session.refetch()} />
            )}
          </div>
        )}
      </Panel>
    </section>
  );
}

function PlaceBlock(props: {
  canPlace: boolean;
  summary: string | null;
  onPlace: () => void;
  placing: boolean;
  placeError: string | null;
  plan: PlanView | null;
}) {
  const { plan } = props;
  const entered = plan?.status === "entered" || plan?.status === "partially_entered";
  return (
    <div className="grid gap-3">
      <Button
        variant="action"
        className="w-full py-3 text-sm"
        disabled={!props.canPlace}
        onClick={props.onPlace}
      >
        Place order
      </Button>
      {props.summary && <p className="-mt-1.5 text-center font-mono text-muted text-xs">{props.summary}</p>}
      {props.placeError && <WarnBox tone="loss">{props.placeError}</WarnBox>}
      {plan && (
        <div data-testid="plan-status" className="grid gap-2">
          {plan.status === "entry_failed" ? (
            <WarnBox tone="loss">Entry not filled: no position was opened and no stop was armed.</WarnBox>
          ) : (
            <>
              {!entered && <p className="text-brand text-xs">Sending entry…</p>}
              <StepTracker
                steps={[
                  { label: "Entry filled", state: entered ? "done" : "now" },
                  { label: "Arming stop", state: entered ? (plan.stopId ? "done" : "now") : "todo" },
                  { label: "Protected", state: entered && plan.stopId ? "done" : "todo" },
                ]}
              />
            </>
          )}
        </div>
      )}
      <p className="text-muted text-xs leading-relaxed">
        PerpLog's bot sends one market order with your linked bot key. If it does not fill, nothing is opened
        and no stop is armed.
      </p>
    </div>
  );
}
