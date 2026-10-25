import { formatUsd } from "@perplog/core";
import { AddressForm } from "@/components/address-form";
import stats from "@/data/platform-stats.json";

const EXAMPLE = [
  { label: "Realized PnL", value: "-609.70" },
  { label: "Funding paid", value: "-187.10" },
] as const;

export default function Home() {
  const liquidationFees = formatUsd(BigInt(stats.liquidationFees7dRaw)).replace(/\.\d+ USDso$/, " USDso");
  const generated = new Date(stats.generatedAt).toLocaleDateString("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-20 sm:px-6">
      <section className="grid items-center gap-12 py-14 lg:grid-cols-[minmax(0,1fr)_24rem] lg:py-20">
        <div>
          <h1 className="max-w-[18ch] font-extrabold text-4xl leading-[1.05] tracking-tight sm:text-5xl">
            Your true perps PnL on dreamDEX — after funding and liquidation fees.
          </h1>
          <p className="mt-5 mb-8 max-w-prose text-lg text-muted">
            The realized PnL the app shows leaves out funding and liquidation fees. PerpLog rebuilds every
            trade from the chain, checks the total against your on-chain balance, and shows where the money
            went.
          </p>
          <AddressForm />
        </div>
        <figure className="rounded-md border border-rule bg-sheet px-5 py-4">
          <figcaption className="mb-2 text-muted text-sm">One account we checked</figcaption>
          {EXAMPLE.map((row) => (
            <div key={row.label} className="flex justify-between py-1.5 text-lg">
              <span className="text-muted">{row.label}</span>
              <span className="text-loss">{row.value} USDso</span>
            </div>
          ))}
          <div className="my-2 border-ink border-t-2" />
          <div className="-mx-2 flex justify-between rounded-sm bg-marker/35 px-2 py-1.5 font-extrabold text-2xl">
            <span>Net PnL</span>
            <span className="text-loss">-796.80 USDso</span>
          </div>
          <p className="mt-3 text-muted text-sm">Funding made this loss 31% bigger than the app shows.</p>
        </figure>
      </section>

      <section aria-labelledby="platform-title" className="border-rule border-t pt-10">
        <h2 id="platform-title" className="mb-6 font-bold text-2xl">
          What we see across dreamDEX perps
        </h2>
        <ul className="grid gap-6 text-lg sm:grid-cols-2">
          <li className="max-w-prose">
            <strong className="font-extrabold">{stats.noStopPct}%</strong> of new positions opened by real
            traders had no stop-loss within 10 minutes ({stats.newPositions} positions from{" "}
            {stats.realTraders} traders).
          </li>
          <li className="max-w-prose">
            Traders paid <strong className="font-extrabold">{liquidationFees}</strong> in liquidation fees in
            the last 7 days, across {stats.liquidatedAccounts7d} accounts.
          </li>
        </ul>
        <p className="mt-6 text-muted text-sm">
          Computed from the dreamDEX indexer on {generated}. Automated accounts are excluded.
        </p>
      </section>
    </main>
  );
}
