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
import { useBook } from "@/lib/use-book";
import { useProtectionAvailable, useSessionState } from "@/lib/use-protection";
import { ErrorState } from "./error-state";
import { PlanSummary } from "./plan/plan-summary";
import { ProtectionStrip } from "./plan/protection-strip";
import { type PlanView, type QuoteView, quoteErrorText, type Side } from "./plan/shared";
import { Ticket } from "./plan/ticket";
import { Button, Panel, StepTracker, WarnBox } from "./ui";

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
  const book = useBook(market?.pool ?? null);
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
  const base = market.symbol.replace(/-PERP$/i, "");
  const linkedAccount =
    session.data?.status === "linked" ? (session.data.account?.toLowerCase() ?? null) : null;
  const q = quote.data;
  const quoteError = quote.error instanceof PlanError ? quote.error.code : quote.error ? "unknown" : null;
  const fmtPrice = (raw: string) => formatAmount(BigInt(raw), PRICE_DECIMALS, priceDp);

  const placeBlock =
    available && !session.isPending && linkedAccount === address.toLowerCase() ? (
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
            ? `${side} ${formatAmount(BigInt(q.qtyRaw), market.baseDecimals, sizeDp)} ${base} · stop ${fmtPrice(q.stopPrice)}`
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
          planId ? (plan.data ?? { id: planId, status: "pending_entry", stopId: null, txHash: null }) : null
        }
      />
    ) : null;

  return (
    <section className="grid gap-4">
      <ProtectionStrip
        available={available}
        checking={session.isPending}
        linkedAccount={linkedAccount}
        botAddress={session.data?.botAddress ?? null}
        address={address}
        onLinked={() => session.refetch()}
      />
      <div className="grid items-start gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Ticket
          markets={markets.data ?? []}
          market={market}
          onMarket={setPool}
          book={book}
          priceDp={priceDp}
          side={side}
          onSide={setSide}
          risk={risk}
          onRisk={setRisk}
          riskInvalid={risk !== "" && !riskRaw}
          stop={stop}
          onStop={setStop}
          stopInvalid={stop !== "" && !stopRaw}
          place={placeBlock}
        />
        <div data-testid="plan-quote" className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <Panel className="min-h-[360px]">
            {!input ? (
              <p className="text-muted">Enter how much you are willing to lose and where your stop goes.</p>
            ) : quoteError ? (
              <WarnBox tone="loss">{quoteErrorText(quoteError, side)}</WarnBox>
            ) : !q ? (
              <p className="text-muted">Reading the book…</p>
            ) : null}
          </Panel>
          <Panel>
            <PlanSummary quote={quoteError ? null : (q ?? null)} market={market} side={side} />
          </Panel>
        </div>
      </div>
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
