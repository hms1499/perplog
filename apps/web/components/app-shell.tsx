"use client";

import type { Address } from "@perplog/core";
import Link from "next/link";
import type { ReactNode } from "react";
import { BotChip } from "./bot-chip";
import { CopyAddress } from "./copy-address";
import { HealthIcon, JournalIcon, LeaksIcon, PlanIcon, PositionsIcon, ReportIcon } from "./icons";
import { Badge, Footer, Wordmark } from "./ui";
import { WatchButton } from "./watch-button";

const ICONS: Record<string, () => ReactNode> = {
  health: HealthIcon,
  journal: JournalIcon,
  leaks: LeaksIcon,
  positions: PositionsIcon,
  plan: PlanIcon,
  report: ReportIcon,
};

/**
 * The account app frame (spec §5): a sidebar on wide screens that becomes a sticky header with a scrolling tab
 * row on narrow ones. One DOM tree re-laid out by CSS, so e2e finds every link and text exactly once.
 */
export function AppShell<Tab extends string>({
  address,
  tab,
  tabs,
  href,
  rangeControl,
  children,
}: {
  address: Address;
  tab: Tab;
  tabs: ReadonlyArray<{ value: Tab; label: string }>;
  href: (next: { tab?: Tab }) => string;
  rangeControl: ReactNode | null;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="sticky top-0 z-20 flex flex-wrap items-center border-line border-b bg-panel lg:h-dvh lg:flex-col lg:flex-nowrap lg:items-stretch lg:border-r lg:border-b-0">
        <div className="flex h-14 flex-1 items-center gap-3 px-4 lg:flex-none lg:px-5">
          <Wordmark />
          <Badge tone="testnet">Testnet</Badge>
        </div>
        <div className="flex gap-4 px-4 text-[13px] text-muted lg:order-3 lg:mt-2 lg:grid lg:gap-1 lg:border-line lg:border-t lg:px-5 lg:pt-4">
          <Link href="/evidence" className="hover:text-head">
            Evidence
          </Link>
          <Link href="/how-it-works" className="hover:text-head">
            How it works
          </Link>
        </div>
        <nav
          aria-label="Account sections"
          className="flex basis-full gap-1 overflow-x-auto whitespace-nowrap px-2 lg:order-2 lg:mt-2 lg:basis-auto lg:flex-col lg:overflow-visible lg:px-3"
        >
          {tabs.map((t) => {
            const Icon = ICONS[t.value];
            const current = t.value === tab;
            return (
              <Link
                key={t.value}
                href={href({ tab: t.value })}
                aria-current={current ? "page" : undefined}
                scroll={false}
                className="relative flex items-center gap-2.5 rounded-md px-3 py-2.5 font-medium text-muted hover:bg-field hover:text-head aria-[current=page]:bg-field aria-[current=page]:text-head lg:py-2"
              >
                {Icon && <Icon />}
                {t.label}
                {current && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-2 bottom-0 h-0.5 rounded bg-brand lg:inset-x-auto lg:inset-y-1.5 lg:left-0 lg:h-auto lg:w-0.5"
                  />
                )}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="z-10 border-line border-b bg-page/95 backdrop-blur lg:sticky lg:top-0">
          <div className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6 lg:px-8">
            <CopyAddress address={address} />
            <WatchButton account={address} />
            <div className="flex-1" />
            {rangeControl}
            <BotChip account={address} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        <Footer />
      </div>
    </div>
  );
}
