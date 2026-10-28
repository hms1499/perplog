"use client";

import { useMutation } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import { useProtectionAvailable } from "@/lib/use-protection";

async function watch(account: string): Promise<void> {
  // Ask first, while the click still counts as a user gesture; alerts still show in-app if refused.
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    await Notification.requestPermission().catch(() => "denied");
  }
  const res = await fetch("/api/watch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? "unknown");
}

export function WatchButton({ account }: { account: string }) {
  const available = useProtectionAvailable();
  const mutation = useMutation({ mutationFn: () => watch(account) });
  if (!available) return null;
  if (mutation.isSuccess) {
    return (
      <span
        role="status"
        className="rounded-md border border-line px-3 py-1 font-semibold text-muted text-sm"
      >
        Watching
      </span>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="rounded-md border border-line-strong bg-panel px-3 py-1 font-semibold text-sm disabled:opacity-50"
      >
        Watch this account
      </button>
      {mutation.isError && (
        <span role="alert" className="text-loss text-sm">
          {mutation.error instanceof ApiError && mutation.error.code === "rate_limited"
            ? "Too many attempts. Try again in a minute."
            : "Could not start watching. Try again."}
        </span>
      )}
    </div>
  );
}
