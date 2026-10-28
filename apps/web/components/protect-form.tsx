"use client";

import { type OpenPosition, PRICE_DECIMALS, parseAmount } from "@perplog/core";
import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { ApiError, type Wire } from "@/lib/api";

type Position = Wire<OpenPosition>;

class StopError extends ApiError {
  constructor(
    status: number,
    code: string,
    readonly apiMessage: string | null,
  ) {
    super(status, code);
  }
}

async function armStop(body: { pool: string; triggerPrice: string; qtyMode: string; qtyRaw?: string }) {
  const res = await fetch("/api/stops", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new StopError(res.status, json.error ?? "unknown", json.message ?? null);
}

/** One line per API error code; `pool_not_linked` carries its own re-link instructions. */
function errorText(error: unknown, side: "long" | "short"): string {
  if (!(error instanceof StopError)) return "Could not arm the stop. Try again.";
  switch (error.code) {
    case "pool_not_linked":
      return (
        error.apiMessage ?? "PerpLog's bot is not linked for this market. Link it again in the dreamDEX app."
      );
    case "trigger_wrong_side":
      return side === "long"
        ? "For a long, the trigger must be below the current mark."
        : "For a short, the trigger must be above the current mark.";
    case "bad_quantity":
      return "The size must be at least the market's minimum and at most your position.";
    case "no_position":
      return "This position is already closed.";
    case "unknown_pool":
      return "PerpLog does not know this market yet.";
    case "invalid_input":
      return "Check the trigger price and size.";
    case "no_session":
    case "not_linked":
      return "Link PerpLog's bot first.";
    case "rate_limited":
      return "Too many attempts. Wait a minute and try again.";
    case "db_unavailable":
      return "Protection is not available on this deployment.";
    case "chain_unavailable":
      return "Could not read the chain. Try again in a moment.";
    default:
      return "Could not arm the stop. Try again.";
  }
}

export function ProtectForm({ position, onArmed }: { position: Position; onArmed: () => void }) {
  const id = useId();
  const [trigger, setTrigger] = useState("");
  const [mode, setMode] = useState<"entire" | "fixed">("entire");
  const [size, setSize] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const mutation = useMutation({ mutationFn: armStop, onSuccess: onArmed });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const triggerRaw = parseAmount(trigger, PRICE_DECIMALS);
    if (triggerRaw === null || triggerRaw === 0n) return setInputError("Enter a trigger price.");
    let qtyRaw: bigint | null = null;
    if (mode === "fixed") {
      qtyRaw = parseAmount(size, position.baseDecimals);
      if (qtyRaw === null || qtyRaw === 0n) return setInputError("Enter the size to close.");
    }
    setInputError(null);
    mutation.mutate({
      pool: position.pool,
      triggerPrice: triggerRaw.toString(),
      qtyMode: mode,
      ...(qtyRaw !== null ? { qtyRaw: qtyRaw.toString() } : {}),
    });
  }

  const message = inputError ?? (mutation.isError ? errorText(mutation.error, position.side) : null);

  return (
    <form onSubmit={submit} className="rounded-md border border-line bg-panel p-5">
      <h2 className="font-semibold text-head text-lg">Protect {position.symbol}</h2>
      <p className="mt-1 text-muted">
        When the mark crosses the trigger, PerpLog's bot closes this {position.side} at market.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-6">
        <label htmlFor={`${id}-trigger`} className="flex flex-col gap-1">
          <span className="font-semibold">Trigger price</span>
          <input
            id={`${id}-trigger`}
            inputMode="decimal"
            autoComplete="off"
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            className="w-40 rounded-md border border-line bg-field px-3 py-1.5"
          />
        </label>
        <fieldset className="flex flex-col gap-1">
          <legend className="font-semibold">Close</legend>
          <div className="flex gap-4 pt-1">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`${id}-mode`}
                checked={mode === "entire"}
                onChange={() => setMode("entire")}
              />
              Entire position
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`${id}-mode`}
                checked={mode === "fixed"}
                onChange={() => setMode("fixed")}
              />
              Fixed size
            </label>
          </div>
        </fieldset>
        {mode === "fixed" && (
          <label htmlFor={`${id}-size`} className="flex flex-col gap-1">
            <span className="font-semibold">Size</span>
            <input
              id={`${id}-size`}
              inputMode="decimal"
              autoComplete="off"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="w-32 rounded-md border border-line bg-field px-3 py-1.5"
            />
          </label>
        )}
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-md bg-action px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          Arm stop
        </button>
      </div>
      {message && (
        <p role="alert" className="mt-3 text-loss">
          {message}
        </p>
      )}
    </form>
  );
}
