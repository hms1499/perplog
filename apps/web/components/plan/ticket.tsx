"use client";

import { formatAmount, type MarketInfo, PRICE_DECIMALS } from "@perplog/core";
import type { ReactNode } from "react";
import type { Wire } from "@/lib/api";
import { type Book, stopShortcut } from "@/lib/ladder";
import { Field, Label, Panel, Segmented } from "../ui";
import { BookLine } from "./book-line";
import type { Side } from "./shared";

const SHORTCUTS = [1, 2, 3, 5] as const;

/** The order ticket (spec §6.2): market, live book, side, risk and stop, then whatever `place` renders. */
export function Ticket(props: {
  markets: Wire<MarketInfo>[];
  market: Wire<MarketInfo>;
  onMarket: (pool: string) => void;
  book: Book;
  priceDp: number;
  side: Side;
  onSide: (side: Side) => void;
  risk: string;
  onRisk: (value: string) => void;
  riskInvalid: boolean;
  stop: string;
  onStop: (value: string) => void;
  stopInvalid: boolean;
  place: ReactNode;
}) {
  const { market, book, side, priceDp } = props;
  const price = (raw: bigint) => formatAmount(raw, PRICE_DECIMALS, priceDp);
  const tick = BigInt(market.tickSize);
  const shortcuts = SHORTCUTS.map((pct) => ({ pct, value: stopShortcut(side, book, pct, tick) })).filter(
    (s): s is { pct: (typeof SHORTCUTS)[number]; value: bigint } => s.value !== null,
  );
  const reference = side === "long" ? book.bestAsk : book.bestBid;
  const hint =
    side === "long"
      ? `Below the current ask${reference !== null ? ` (${price(reference)})` : ""}.`
      : `Above the current bid${reference !== null ? ` (${price(reference)})` : ""}.`;

  return (
    <Panel className="grid content-start gap-4">
      <div className="grid gap-2">
        <label htmlFor="plan-market" className="text-[13px] text-muted">
          Market
        </label>
        <select
          id="plan-market"
          value={market.pool}
          onChange={(e) => props.onMarket(e.target.value)}
          className="h-[42px] w-full rounded-lg border border-line bg-field px-3 font-semibold text-head"
        >
          {props.markets.map((m) => (
            <option key={m.pool} value={m.pool}>
              {m.symbol}
            </option>
          ))}
        </select>
        <BookLine book={book} price={price} />
      </div>
      <div>
        <Label>Side</Label>
        <div className="mt-1.5">
          <Segmented
            label="Side"
            tone="side"
            value={side}
            onChange={props.onSide}
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
        value={props.risk}
        onChange={(e) => props.onRisk(e.target.value)}
        invalid={props.riskInvalid}
      />
      <div>
        <Field
          id="plan-stop"
          label="Stop price"
          unit="USDso"
          inputMode="decimal"
          placeholder={side === "long" ? "below the ask" : "above the bid"}
          value={props.stop}
          onChange={(e) => props.onStop(e.target.value)}
          invalid={props.stopInvalid}
          hint={hint}
        />
        {shortcuts.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {shortcuts.map((s) => (
              <button
                key={s.pct}
                type="button"
                onClick={() =>
                  props.onStop(formatAmount(s.value, PRICE_DECIMALS, priceDp).replaceAll(",", ""))
                }
                className="rounded-md border border-line px-2.5 py-1 text-muted text-xs tabular-nums hover:border-line-strong hover:text-head"
              >
                {side === "long" ? "−" : "+"}
                {s.pct}%
              </button>
            ))}
          </div>
        )}
      </div>
      {props.place && <div className="border-line border-t pt-4">{props.place}</div>}
    </Panel>
  );
}
