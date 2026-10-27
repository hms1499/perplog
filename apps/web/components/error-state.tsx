import { ApiError } from "@/lib/api";

const MESSAGE: Record<string, string> = {
  indexer_unavailable: "The dreamDEX indexer is not responding.",
  chain_unavailable: "The Somnia RPC is not responding.",
};

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message =
    (error instanceof ApiError && MESSAGE[error.code]) || "Something went wrong while loading this account.";
  return (
    <div className="py-10" role="alert">
      <p className="mb-3 text-lg">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-ink px-4 py-2 font-semibold"
      >
        Retry
      </button>
    </div>
  );
}
