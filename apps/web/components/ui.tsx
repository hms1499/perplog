import { type Address, formatUsd, shortAddress } from "@perplog/core";
import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

// Presentational building blocks of the design system (docs/specs/2026-10-28-perplog-design-system.md §5).
// No data fetching here; every color is a token.

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cx("rounded-xl border border-line bg-panel p-[18px]", className)}>{children}</section>
  );
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("text-muted text-xs uppercase tracking-[0.3px]", className)}>{children}</div>;
}

const TONE = { gain: "text-gain", loss: "text-loss", warn: "text-warn", head: "text-head" } as const;
export type Tone = keyof typeof TONE;

export function StatTile({ label, value, tone = "head" }: { label: string; value: ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-3.5">
      <Label>{label}</Label>
      <div className={cx("mt-1 font-mono text-[22px]", TONE[tone])}>{value}</div>
    </div>
  );
}

/** A number in Geist Mono; `tone="auto"` colors it by the sign of `raw`. */
export function Num({
  raw,
  text,
  tone,
  className,
}: {
  raw?: bigint;
  text?: string;
  tone?: "auto" | "gain" | "loss";
  className?: string;
}) {
  const color =
    tone === "auto" && raw !== undefined
      ? raw > 0n
        ? "text-gain"
        : raw < 0n
          ? "text-loss"
          : ""
      : tone === "gain"
        ? "text-gain"
        : tone === "loss"
          ? "text-loss"
          : "";
  const shown = text ?? (raw !== undefined ? formatUsd(raw) : "");
  return <span className={cx("font-mono tabular-nums", color, className)}>{shown}</span>;
}

export function Field({
  id,
  label,
  unit,
  hint,
  invalid,
  ...input
}: {
  id: string;
  label: string;
  unit?: string;
  hint?: ReactNode;
  invalid?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "id">) {
  return (
    <div>
      <label htmlFor={id} className="text-muted text-xs uppercase tracking-[0.3px]">
        {label}
      </label>
      <div
        className={cx(
          "mt-1.5 flex h-[46px] items-center gap-2 rounded-lg border bg-field px-3 focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand/15",
          invalid ? "border-loss" : "border-line",
        )}
      >
        <input
          id={id}
          className="min-w-0 flex-1 bg-transparent font-mono text-base text-head outline-none placeholder:text-muted/60"
          aria-invalid={invalid || undefined}
          // The wrapper draws the focus ring (focus-within); a second outline on the bare input would double it.
          style={{ outline: "none" }}
          {...input}
        />
        {unit && <span className="text-muted text-xs">{unit}</span>}
      </div>
      {hint && <div className="mt-1.5 text-muted text-xs">{hint}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  tone,
  label,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  /** "side": the selected segment is filled long-green or short-red. */
  tone?: "side";
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx(
        "grid gap-0.5 rounded-lg border border-line bg-field p-0.5",
        tone === "side" ? "grid-cols-2" : "inline-grid grid-flow-col",
      )}
    >
      {options.map((o) => {
        const on = o.value === value;
        const filled =
          tone === "side" && on
            ? o.value === "short"
              ? "bg-loss-fill text-white"
              : "bg-gain text-white"
            : "";
        return (
          // biome-ignore lint/a11y/useSemanticElements: a styled radio group of buttons, like the dreamDEX ticket
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx(
              "rounded-md px-3 py-1.5 font-semibold text-xs",
              filled || (on ? "bg-panel text-head shadow-sm" : "text-muted"),
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const BUTTON = {
  action: "bg-action text-white hover:bg-action-hover",
  ghost: "border border-line-strong bg-panel text-text hover:bg-field",
  x: "bg-x text-white hover:opacity-90",
} as const;

export function Button({
  variant,
  className,
  ...props
}: { variant: keyof typeof BUTTON } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx(
        "rounded-lg px-3 py-2 font-semibold text-[13px] disabled:cursor-not-allowed disabled:opacity-50",
        BUTTON[variant],
        className,
      )}
      {...props}
    />
  );
}

const BADGE = {
  testnet: "border-testnet-line bg-testnet-bg text-testnet",
  ok: "border-gain/40 bg-gain/10 text-gain",
  warn: "border-warn/40 bg-warn/10 text-warn",
  loss: "border-loss/40 bg-loss/10 text-loss",
} as const;

export function Badge({ tone, children }: { tone: keyof typeof BADGE; children: ReactNode }) {
  return (
    <span
      className={cx("inline-block rounded-md border px-[7px] py-[3px] font-semibold text-xs", BADGE[tone])}
    >
      {children}
    </span>
  );
}

const PILL = {
  brand: "border-brand/40 bg-brand/10 text-brand",
  action: "border-action/40 bg-action/10 text-action",
} as const;

export function Pill({ tone, children }: { tone: keyof typeof PILL; children: ReactNode }) {
  return (
    <span className={cx("inline-block rounded-full border px-2 py-0.5 font-semibold text-xs", PILL[tone])}>
      {children}
    </span>
  );
}

export function BreakdownRow({ label, value, total }: { label: string; value: ReactNode; total?: boolean }) {
  return (
    <div
      className={cx(
        "flex items-baseline justify-between border-line border-t border-dashed py-[7px] first:border-t-0",
        total && "font-semibold text-head",
      )}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function WarnBox({ tone = "warn", children }: { tone?: "warn" | "loss"; children: ReactNode }) {
  return (
    <div
      role={tone === "loss" ? "alert" : "status"}
      className={cx(
        "rounded-lg border px-2.5 py-2 text-xs",
        tone === "loss" ? "border-loss/40 bg-loss/10 text-loss" : "border-warn/40 bg-warn/10 text-warn",
      )}
    >
      {children}
    </div>
  );
}

export function StepTracker({ steps }: { steps: Array<{ label: string; state: "done" | "now" | "todo" }> }) {
  return (
    <ol className="grid grid-cols-3 gap-1.5">
      {steps.map((s) => (
        <li
          key={s.label}
          aria-current={s.state === "now" ? "step" : undefined}
          className={cx(
            "rounded-md border px-1 py-[7px] text-center text-xs",
            s.state === "done" && "border-gain/40 bg-gain/10 font-semibold text-gain",
            s.state === "now" && "border-brand/40 bg-brand/10 font-semibold text-brand",
            s.state === "todo" && "border-line bg-field text-muted",
          )}
        >
          {s.state === "done" ? "✓ " : s.state === "now" ? "● " : ""}
          {s.label}
        </li>
      ))}
    </ol>
  );
}

export function Wordmark() {
  return (
    <Link href="/" className="font-mono font-semibold text-[17px] text-head tracking-[-0.3px]">
      perp<span className="text-brand">log</span>
    </Link>
  );
}

export function NavBar({ address }: { address?: Address }) {
  return (
    <header className="mx-auto w-full max-w-5xl px-4 pt-3 sm:px-6">
      <nav className="flex items-center gap-4 rounded-xl border border-line bg-panel px-4 py-2.5">
        <Wordmark />
        <Badge tone="testnet">Testnet</Badge>
        <div className="ml-2 hidden gap-[18px] text-[13px] text-muted sm:flex">
          {address && (
            <Link href={`/a/${address}`} className="hover:text-head">
              Account
            </Link>
          )}
          <Link href="/evidence" className="hover:text-head">
            Evidence
          </Link>
          <Link href="/how-it-works" className="hover:text-head">
            How it works
          </Link>
        </div>
        <div className="flex-1" />
        {address && (
          <span className="rounded-lg border border-line bg-field px-2.5 py-1.5 font-mono text-xs">
            {shortAddress(address)}
          </span>
        )}
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="py-6 text-center text-[11px] text-muted">
      Independent tool for dreamDEX traders · not affiliated with dreamDEX
    </footer>
  );
}
