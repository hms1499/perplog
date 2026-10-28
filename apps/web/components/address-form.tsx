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
          className="min-w-0 flex-1 rounded-md border border-line bg-panel px-3 py-2.5 text-base"
        />
        <button type="submit" className="rounded-md bg-action px-5 py-2.5 font-semibold text-white">
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
