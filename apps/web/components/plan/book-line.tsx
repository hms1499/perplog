import type { Book } from "@/lib/ladder";

/** Best bid and ask of the selected market, at tick decimals; "—" for a side that cannot be read. */
export function BookLine({ book, price }: { book: Book; price: (raw: bigint) => string }) {
  return (
    <div
      data-testid="book-line"
      className="grid grid-cols-2 divide-x divide-line rounded-lg border border-line bg-field text-sm"
    >
      <div className="flex items-baseline justify-between gap-2 px-3 py-2">
        <span className="text-muted">Bid</span>
        <span className="text-gain tabular-nums">{book.bestBid !== null ? price(book.bestBid) : "—"}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2 px-3 py-2">
        <span className="text-muted">Ask</span>
        <span className="text-loss tabular-nums">{book.bestAsk !== null ? price(book.bestAsk) : "—"}</span>
      </div>
    </div>
  );
}
