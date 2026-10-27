import { type EnrichedTrade, type ExitType, formatAmount, formatUsd, PRICE_DECIMALS } from "@perplog/core";
import type { Wire } from "@/lib/api";
import { EXPLORER_TX, formatTime, signClass } from "@/lib/format";

export const EXIT_LABEL: Record<ExitType, string> = {
  LIQUIDATED: "Liquidated",
  NATIVE_STOP: "Stop-loss (dreamDEX)",
  PERPLOG_STOP: "Stop-loss (PerpLog)",
  MANUAL: "Manual",
  OPEN: "Open",
};

const EXIT_TONE: Record<ExitType, string> = {
  LIQUIDATED: "bg-loss text-paper",
  NATIVE_STOP: "border border-ink",
  PERPLOG_STOP: "border border-ink",
  MANUAL: "border border-rule text-muted",
  OPEN: "bg-ink text-paper",
};

function Money({ label, raw, strong = false }: { label: string; raw: bigint; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4 sm:block sm:text-right">
      <dt className="text-muted text-xs">{label}</dt>
      <dd className={`${strong ? "font-bold" : ""} ${signClass(raw)}`}>
        {formatUsd(raw).replace(" USDso", "")}
      </dd>
    </div>
  );
}

export function TradeCard({ trade }: { trade: Wire<EnrichedTrade> }) {
  const price = (raw: string | null) =>
    raw === null ? "—" : formatAmount(BigInt(raw), PRICE_DECIMALS, trade.priceDecimals);
  // A trade whose history starts mid-position may not know its entry price.
  const entry = trade.partialHistory && trade.entryPrice === "0" ? "—" : price(trade.entryPrice);
  return (
    <article
      data-testid="trade-card"
      className="grid gap-4 border-rule border-b py-4 sm:grid-cols-[minmax(0,1fr)_auto]"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-bold text-lg">{trade.symbol}</h3>
          <span
            className={`rounded-sm px-1.5 py-0.5 font-semibold text-xs ${trade.side === "long" ? "text-gain" : "text-loss"}`}
          >
            {trade.side === "long" ? "Long" : "Short"}
          </span>
          <span className={`rounded-sm px-1.5 py-0.5 font-semibold text-xs ${EXIT_TONE[trade.exitType]}`}>
            {EXIT_LABEL[trade.exitType]}
          </span>
          {!trade.hadStop && trade.exitType !== "OPEN" && (
            <span className="rounded-sm bg-marker/40 px-1.5 py-0.5 font-semibold text-marker-ink text-xs">
              No stop-loss
            </span>
          )}
          {trade.partialHistory && (
            <span
              className="rounded-sm border border-rule px-1.5 py-0.5 text-muted text-xs"
              title="The indexed history starts after this position was opened."
            >
              History starts mid-trade
            </span>
          )}
        </div>
        <p className="mt-1 text-muted text-sm">
          {formatTime(trade.openedAt)}
          {trade.closedAt !== null && ` to ${formatTime(trade.closedAt)}`}
        </p>
        <p className="mt-1 text-sm">
          Entry {entry} → exit {price(trade.exitVwap)}
          <span className="ml-3 text-muted">
            Max size {formatAmount(BigInt(trade.maxSize), trade.baseDecimals, trade.sizeDecimals)}
          </span>
          <a
            href={`${EXPLORER_TX}${trade.lastChange.txHash}`}
            target="_blank"
            rel="noreferrer"
            className="ml-3 text-muted underline underline-offset-2"
          >
            View tx
          </a>
        </p>
      </div>
      <dl className="grid grid-cols-1 gap-1 sm:grid-cols-4 sm:gap-6">
        <Money label="Realized" raw={BigInt(trade.realizedPnl)} />
        <Money label="Funding" raw={-BigInt(trade.costs.funding)} />
        <Money label="Liquidation fee" raw={-BigInt(trade.costs.liquidationFee)} />
        <Money label="Net" raw={BigInt(trade.netPnl)} strong />
      </dl>
    </article>
  );
}
