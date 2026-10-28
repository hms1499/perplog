"use client";

import { type Address, shortAddress } from "@perplog/core";
import { useEffect, useState } from "react";
import { CopyIcon } from "./icons";

/** The account's short address in mono, with a button that copies the full lowercase address. */
export function CopyAddress({ address }: { address: Address }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1_500);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = () => {
    // A refused clipboard (permissions, insecure context) just leaves the button as it was.
    navigator.clipboard
      ?.writeText(address)
      .then(() => setCopied(true))
      .catch(() => {});
  };

  return (
    <div className="flex items-center gap-1.5">
      <h1 className="font-medium font-mono text-[15px] text-head" title={address}>
        {shortAddress(address)}
      </h1>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy address"
        className="rounded-md p-1 text-muted hover:bg-field hover:text-head"
      >
        <CopyIcon />
      </button>
      {copied && (
        <span role="status" className="text-brand text-xs">
          Copied
        </span>
      )}
    </div>
  );
}
