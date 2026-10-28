import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteChrome } from "@/components/site-chrome";
import { Panel } from "@/components/ui";

export const metadata: Metadata = {
  title: "How it works · PerpLog",
  description: "How PerpLog links a bot, why its stops are bot-held, and exactly what the bot may send.",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel>
      <h2 className="font-semibold text-head text-lg">{title}</h2>
      <div className="mt-2 grid gap-2 text-[15px] leading-relaxed">{children}</div>
    </Panel>
  );
}

export default function HowItWorksPage() {
  return (
    <SiteChrome>
      <main className="mx-auto grid w-full max-w-3xl gap-3 py-6 pb-16">
        <h1 className="font-semibold text-[22px] text-head">How PerpLog works</h1>
        <Section title="Linking proves ownership">
          <p>
            dreamDEX app accounts are Safe smart accounts whose only owner is a key the app holds, so no
            external wallet can sign for them. Instead, you link PerpLog's bot from inside the dreamDEX app
            (wallet → Link a bot → Perps). Only the account's owner can do that, so the link itself is the
            proof.
          </p>
          <p>
            The bot gets the <code className="font-mono">placeOrderFor</code> permission on the markets you
            tick. It cannot withdraw or move funds. You can unlink it in the app at any time.
          </p>
        </Section>
        <Section title="Why stops are bot-held">
          <p>
            An exchange-native stop created by a linked bot reverts with{" "}
            <code className="font-mono">InvalidOrderOwner()</code>: only the account itself may arm one. So
            PerpLog holds the stop: its worker watches the mark every second and closes the position through
            the bot when the trigger is crossed.
          </p>
        </Section>
        <Section title="What the bot may send">
          <p>
            <strong>Closes for a stop you armed.</strong> Before every close it re-reads your live position,
            never sends more than its size, and never resends while an earlier order's outcome is unknown. A
            close cannot flip a position.
          </p>
          <p>
            <strong>The entry of a Plan &amp; Place you confirmed.</strong> It is sent at most once (never
            retried, even after a restart), only while you are flat on that market, within 30 seconds of your
            click, at the size PerpLog quoted. Its stop is armed as soon as it fills.
          </p>
          <p>Nothing else. Every order is listed on the Evidence page with its transaction.</p>
        </Section>
        <Section title="Limits">
          <p>
            Closes are market (IOC) orders: on a thin book a close may fill partly or not at all, and PerpLog
            retries with wider slippage for up to 15 seconds before alerting you. One worker signs at a time.
            PerpLog runs on Somnia's Tokyo testnet.
          </p>
        </Section>
      </main>
    </SiteChrome>
  );
}
