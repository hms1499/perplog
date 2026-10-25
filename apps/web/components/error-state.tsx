export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="py-10" role="alert">
      <p className="mb-3 text-lg">The dreamDEX indexer is not responding.</p>
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
