import { formatUsd } from "@perplog/core";
import Link from "next/link";
import { AddressForm } from "@/components/address-form";
import { MeasureBracket } from "@/components/measure-bracket";
import { SiteChrome } from "@/components/site-chrome";
import stats from "@/data/platform-stats.json";

const STEPS = [
  {
    title: "Check your real PnL",
    body: "Paste your trading account. PerpLog rebuilds every trade from the chain, fees and funding included.",
  },
  {
    title: "Plan a sized entry",
    body: "Say how much you are willing to lose and where your stop goes. PerpLog works out the size.",
  },
  {
    title: "Let PerpLog hold the stop",
    body: "A bot key that can only close your positions watches the mark price and closes at your stop.",
  },
] as const;

export default function Home() {
  const liquidationFees = formatUsd(BigInt(stats.liquidationFees7dRaw)).replace(/\.\d+ USDso$/, " USDso");
  const generated = new Date(stats.generatedAt).toLocaleDateString("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return (
    <SiteChrome>
      <main className="pb-20">
        <section className="grid items-center gap-12 py-14 lg:grid-cols-[minmax(0,1fr)_26rem] lg:py-24">
          <div>
            <h1 className="max-w-[20ch] font-semibold text-[40px] text-head leading-[1.08] tracking-[-0.02em] sm:text-[52px]">
              Your true perps PnL on dreamDEX — after funding and liquidation fees.
            </h1>
            <p className="mt-6 mb-9 max-w-[60ch] text-[17px] text-text leading-relaxed">
              The realized PnL the app shows leaves out funding and liquidation fees. PerpLog rebuilds every
              trade from the chain, checks the total against your on-chain balance, and shows where the money
              went.
            </p>
            <AddressForm />
          </div>
          <figure className="rounded-[10px] border border-line bg-panel p-6">
            <figcaption className="mb-5 text-muted text-sm">One account we checked</figcaption>
            <MeasureBracket
              size="md"
              top={
                <div>
                  <div className="text-[13px] text-muted">App shows</div>
                  <div className="text-[22px] text-muted tabular-nums leading-tight">−609.70</div>
                </div>
              }
              bottom={
                <div>
                  <div className="font-medium text-[13px] text-head">True net</div>
                  <div className="font-semibold text-[28px] text-loss tabular-nums leading-tight">
                    −796.80
                  </div>
                </div>
              }
              label="−187.10 not shown by the app"
            />
            <p className="mt-5 border-line border-t pt-4 text-muted text-sm">
              Funding made this loss 31% bigger than the app shows.
            </p>
          </figure>
        </section>

        <section aria-labelledby="platform-title" className="border-line border-t py-12">
          <h2 id="platform-title" className="mb-8 font-semibold text-head text-xl">
            What we see across dreamDEX perps
          </h2>
          <ul className="grid gap-8 sm:grid-cols-2">
            <li className="max-w-[48ch]">
              <strong className="block font-semibold text-[28px] text-head tabular-nums">
                {stats.noStopPct}%
              </strong>
              <span className="mt-1 block text-[15px] leading-relaxed">
                of new positions opened by real traders had no stop-loss within 10 minutes (
                {stats.newPositions} positions from {stats.realTraders} traders).
              </span>
            </li>
            <li className="max-w-[48ch]">
              <strong className="block font-semibold text-[28px] text-head tabular-nums">
                {liquidationFees}
              </strong>
              <span className="mt-1 block text-[15px] leading-relaxed">
                paid in liquidation fees by traders in the last 7 days, across {stats.liquidatedAccounts7d}{" "}
                accounts.
              </span>
            </li>
          </ul>
          <p className="mt-6 text-muted text-sm">
            Computed from the dreamDEX indexer on {generated}. Automated accounts are excluded.
          </p>
        </section>

        <section aria-labelledby="steps-title" className="border-line border-t py-12">
          <h2 id="steps-title" className="mb-8 font-semibold text-head text-xl">
            From a number to a protected trade
          </h2>
          <ol aria-label="How PerpLog works" className="grid gap-8 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="border-line border-t pt-5">
                <span className="text-brand text-sm tabular-nums">Step {i + 1}</span>
                <h3 className="mt-2 font-semibold text-[17px] text-head">{step.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed">{step.body}</p>
                <Link href="/how-it-works" className="mt-3 inline-block text-brand text-sm hover:underline">
                  How it works
                </Link>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </SiteChrome>
  );
}
