"use client";

import type { Address } from "@perplog/core";
import Link from "next/link";
import { useProtectionAvailable, useSessionState } from "@/lib/use-protection";

/** Whether this browser's PerpLog bot protects the account on screen. Hidden without a database. */
export function BotChip({ account }: { account: Address }) {
  const available = useProtectionAvailable();
  const session = useSessionState(available);
  if (!available || session.isPending) return null;
  const linked =
    session.data?.status === "linked" && session.data.account?.toLowerCase() === account.toLowerCase();
  if (linked) {
    return (
      <span
        data-testid="bot-chip"
        title={session.data?.botAddress ?? undefined}
        className="rounded-full border border-brand/40 bg-brand/10 px-2.5 py-1 font-medium text-brand text-xs"
      >
        ● Protected
      </span>
    );
  }
  return (
    <Link
      data-testid="bot-chip"
      href={`/a/${account}?tab=plan`}
      className="rounded-full border border-line px-2.5 py-1 font-medium text-muted text-xs hover:text-head"
    >
      ○ Protection off
    </Link>
  );
}
