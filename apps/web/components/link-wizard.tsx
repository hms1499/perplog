"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ApiError, getJson } from "@/lib/api";

interface SessionState {
  status: "requested" | "pending" | "linked";
  botAddress: string | null;
  account?: string | null;
  linkedPools?: string[];
  missingPools?: string[];
  symbols?: Record<string, string>;
}

const POLL_MS = 3000;

async function startSession(): Promise<SessionState> {
  const res = await fetch("/api/session", { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? "unknown");
  return body as SessionState;
}

function failureText(error: unknown): string {
  const code = error instanceof ApiError ? error.code : "";
  if (code === "db_unavailable") return "Protection is not available on this deployment.";
  if (code === "rate_limited") return "Too many attempts. Wait a minute and try again.";
  return "Could not start protection. Try again.";
}

export function LinkWizard({ account, onLinked }: { account: string; onLinked: () => void }) {
  const [copied, setCopied] = useState(false);
  const start = useMutation({ mutationFn: startSession });
  const started = start.isSuccess;

  const poll = useQuery({
    queryKey: ["session", account],
    queryFn: () => getJson<SessionState>(`/api/session?account=${account}`),
    enabled: started,
    staleTime: 0,
    refetchInterval: (query) => (query.state.data?.status === "linked" ? false : POLL_MS),
  });

  const state = poll.data ?? start.data;
  const botAddress = state?.botAddress ?? null;
  const linked = poll.data?.status === "linked";

  const notified = useRef(false);
  useEffect(() => {
    if (linked && !notified.current) {
      notified.current = true;
      onLinked();
    }
  }, [linked, onLinked]);

  async function copy() {
    if (!botAddress) return;
    try {
      await navigator.clipboard.writeText(botAddress);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const symbols = poll.data?.symbols ?? {};
  const linkedPools = poll.data?.linkedPools ?? [];
  const missingPools = poll.data?.missingPools ?? [];

  return (
    <section data-testid="link-wizard" className="rounded-md border border-rule bg-sheet p-5">
      <h2 className="font-extrabold text-lg">Protect this account</h2>
      <p className="mt-1 text-muted">
        PerpLog gets its own bot key, which can only close your positions. Link it to your account in three
        steps.
      </p>

      <ol className="mt-5 space-y-6">
        <li>
          <p className="font-semibold">1. Create your bot address</p>
          {!started && (
            <button
              type="button"
              onClick={() => start.mutate()}
              disabled={start.isPending}
              className="mt-2 rounded-md border border-ink px-4 py-2 font-semibold disabled:opacity-50"
            >
              Enable protection
            </button>
          )}
          {start.isError && (
            <p role="alert" className="mt-2 text-loss">
              {failureText(start.error)}
            </p>
          )}
          {started && <p className="mt-1 text-muted">Done.</p>}
        </li>

        {started && (
          <li>
            <p className="font-semibold">2. Link the bot in dreamDEX</p>
            {botAddress ? (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <code data-testid="bot-address" className="break-all rounded-sm bg-rule/40 px-2 py-1">
                  {botAddress}
                </code>
                <button
                  type="button"
                  onClick={copy}
                  className="rounded-md border border-ink px-3 py-1 font-semibold"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            ) : (
              <p className="mt-2 text-muted">Preparing your bot address…</p>
            )}
            <p className="mt-2">
              In the dreamDEX app: open your wallet → Link a bot → tick Perps → paste this address.
            </p>
          </li>
        )}

        {started && (
          <li>
            <p className="font-semibold">3. Confirm the link</p>
            {poll.isError && (
              <p role="alert" className="mt-2 text-loss">
                {failureText(poll.error)}
              </p>
            )}
            {!linked ? (
              <p role="status" className="mt-2 text-muted">
                Waiting for the link…
              </p>
            ) : (
              <>
                <ul className="mt-2 space-y-1">
                  {linkedPools.map((pool) => (
                    <li key={pool}>{symbols[pool] ?? pool}: linked</li>
                  ))}
                  {missingPools.map((pool) => (
                    <li key={pool} className="text-muted">
                      {symbols[pool] ?? pool}: missing
                    </li>
                  ))}
                </ul>
                {missingPools.length > 0 && (
                  <p role="status" className="mt-3 rounded-sm bg-marker/35 px-3 py-2">
                    Some markets are not linked yet. Add the same bot address again in the app to cover them.
                  </p>
                )}
              </>
            )}
          </li>
        )}
      </ol>
    </section>
  );
}
