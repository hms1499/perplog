"use client";

import { type Address, shortAddress } from "@perplog/core";
import { LinkWizard } from "../link-wizard";
import { WarnBox } from "../ui";

/** Whether PerpLog's bot can place and protect plans for this account (spec §6.6). Hidden without a database. */
export function ProtectionStrip(props: {
  available: boolean;
  checking: boolean;
  /** The account this browser's bot is linked to, lowercase; null when not linked. */
  linkedAccount: string | null;
  botAddress: string | null;
  address: string;
  onLinked: () => void;
}) {
  if (!props.available) return null;
  if (props.checking) {
    return <p className="rounded-[10px] border border-line px-4 py-3 text-muted">Checking PerpLog's link…</p>;
  }
  if (props.linkedAccount === props.address.toLowerCase()) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border border-brand/30 bg-brand/5 px-4 py-3">
        <span className="font-medium text-brand">● Protected</span>
        {props.botAddress ? (
          <span className="text-text">
            PerpLog's bot{" "}
            <span className="font-mono text-head" title={props.botAddress}>
              {shortAddress(props.botAddress as Address)}
            </span>{" "}
            can only close your positions.
          </span>
        ) : (
          <span className="text-text">PerpLog's bot can only close your positions.</span>
        )}
      </div>
    );
  }
  if (props.linkedAccount !== null) {
    return (
      <WarnBox>
        This browser's PerpLog bot is linked to another account. Open that account to place a plan.
      </WarnBox>
    );
  }
  return (
    <div className="grid gap-3 rounded-[10px] border border-line bg-panel p-4">
      <p className="text-text">
        <span className="font-medium text-muted">○ Protection is off for this account.</span> Placing a plan
        needs PerpLog's bot key.
      </p>
      <LinkWizard account={props.address} onLinked={props.onLinked} />
    </div>
  );
}
