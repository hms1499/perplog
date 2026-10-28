"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AlertView } from "@/lib/alerts";
import { ApiError, getJson, type Wire } from "@/lib/api";
import { EXPLORER_TX } from "@/lib/format";

const POLL_MS = 5000;

type Alert = Wire<AlertView>;

interface ToastCopy {
  text: string;
  link?: { href: string; label: string; external: boolean };
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** One line of copy per alert type, plus the one action that helps. */
function copyOf(a: Alert, account: string): ToastCopy {
  const symbol = str(a.payload.symbol) ?? a.symbol ?? "a market";
  switch (a.type) {
    case "unprotected_position":
      return {
        text: `${symbol} ${str(a.payload.side) ?? "position"} has no stop-loss.`,
        link: a.pool
          ? { href: `/a/${account}?tab=positions&protect=${a.pool}`, label: "Protect", external: false }
          : undefined,
      };
    case "stop_done": {
      const hashes = Array.isArray(a.payload.txHashes) ? a.payload.txHashes : [];
      const last = str(hashes[hashes.length - 1]);
      return {
        text: `PerpLog stop closed ${symbol}.`,
        link: last ? { href: `${EXPLORER_TX}${last}`, label: "View transaction", external: true } : undefined,
      };
    }
    case "stop_failed":
      return { text: `PerpLog stop on ${symbol} failed: ${str(a.payload.reason) ?? "unknown error"}.` };
    case "bot_low_gas":
      return { text: "PerpLog's bot is low on gas; stops may not fire." };
    case "link_revoked": {
      const n = Array.isArray(a.payload.pools) ? a.payload.pools.length : 1;
      return { text: `PerpLog's bot lost access to ${n} market(s); their stops are paused.` };
    }
    default:
      return { text: "PerpLog has a new alert for this account." };
  }
}

function notify(text: string): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification("PerpLog", { body: text });
  } catch {
    // Some browsers only allow notifications from a service worker; the in-page toast still shows.
  }
}

/**
 * Polls the account's alerts every 5 s from page load and shows each new one once, as a toast and, when the
 * browser allows it, a system notification. Stays silent (and stops polling) without a database.
 */
export function AlertToasts({ account }: { account: string }) {
  const since = useRef(Date.now());
  const seen = useRef(new Set<string>());
  const [toasts, setToasts] = useState<Array<{ id: string; copy: ToastCopy }>>([]);
  const [disabled, setDisabled] = useState(false);

  const poll = useQuery({
    queryKey: ["alerts", account],
    queryFn: () => getJson<{ alerts: Alert[] }>(`/api/alerts?account=${account}&since=${since.current}`),
    enabled: !disabled,
    refetchInterval: disabled ? false : POLL_MS,
    staleTime: 0,
    retry: false,
  });

  useEffect(() => {
    if (poll.error instanceof ApiError && poll.error.status === 503) setDisabled(true);
  }, [poll.error]);

  useEffect(() => {
    const fresh = (poll.data?.alerts ?? []).filter((a) => !seen.current.has(a.id));
    if (fresh.length === 0) return;
    const added = fresh.map((a) => {
      seen.current.add(a.id);
      const at = Date.parse(a.createdAt);
      if (at > since.current) since.current = at;
      const copy = copyOf(a, account);
      notify(copy.text);
      return { id: a.id, copy };
    });
    setToasts((prev) => [...prev, ...added]);
  }, [poll.data, account]);

  if (toasts.length === 0) return null;
  return (
    <div
      aria-live="polite"
      className="fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {toasts.map(({ id, copy }) => (
        <div
          key={id}
          data-testid="alert-toast"
          className="rounded-md border border-line bg-panel p-3 shadow-lg"
        >
          <p>{copy.text}</p>
          <div className="mt-2 flex items-center gap-4 text-sm">
            {copy.link &&
              (copy.link.external ? (
                <a href={copy.link.href} target="_blank" rel="noreferrer" className="font-semibold underline">
                  {copy.link.label}
                </a>
              ) : (
                <Link href={copy.link.href} className="font-semibold underline">
                  {copy.link.label}
                </Link>
              ))}
            <button
              type="button"
              onClick={() => setToasts((prev) => prev.filter((t) => t.id !== id))}
              className="ml-auto text-muted"
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
