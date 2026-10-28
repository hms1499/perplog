"use client";

import { normalizeAddress } from "@perplog/core";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState } from "react";

export function AddressForm({ initial = "" }: { initial?: string }) {
  const router = useRouter();
  const inputId = useId();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const address = normalizeAddress(value);
    if (!address) {
      setError("Enter a valid 0x address");
      return;
    }
    setError(null);
    router.push(`/a/${address}`);
  }

  return (
    <form onSubmit={submit} className="w-full max-w-xl" noValidate>
      <label htmlFor={inputId} className="mb-2 block text-muted text-sm">
        dreamDEX trading account address
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0x…"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className="h-12 min-w-0 flex-1 rounded-lg border border-line bg-field px-3.5 font-mono text-[15px] text-head placeholder:text-muted/60 focus:border-brand"
        />
        <button
          type="submit"
          className="h-12 rounded-lg bg-action px-6 font-semibold text-action-ink hover:bg-action-hover"
        >
          Analyze
        </button>
      </div>
      {error && (
        <p id={`${inputId}-error`} role="alert" className="mt-2 text-loss text-sm">
          {error}
        </p>
      )}
    </form>
  );
}
