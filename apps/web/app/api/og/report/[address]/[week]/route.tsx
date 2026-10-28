import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { formatAmount, normalizeAddress, shortAddress, weekStartSec } from "@perplog/core";
import { ImageResponse } from "next/og";
import { accountService } from "@/lib/service";

// The R2 card (docs/specs/2026-10-28-perplog-design-system.md §6.4) is always dark, whatever the app theme, so
// its colors are fixed here rather than read from the CSS tokens.
const C = {
  bg: "#0e1217",
  text: "#c9d1d9",
  muted: "#8d98a3",
  head: "#ffffff",
  brand: "#20ccff",
  gain: "#00fa89",
  loss: "#ec658d",
};

const FONTS = join(process.cwd(), "assets", "fonts");
let fonts: Promise<{ name: string; data: Buffer; weight: 400 | 600 }[]> | null = null;
const loadFonts = () => {
  fonts ??= Promise.all([
    readFile(join(FONTS, "Geist-Regular.ttf")).then((data) => ({
      name: "Geist",
      data,
      weight: 400 as const,
    })),
    readFile(join(FONTS, "Geist-SemiBold.ttf")).then((data) => ({
      name: "Geist",
      data,
      weight: 600 as const,
    })),
    readFile(join(FONTS, "GeistMono-Regular.ttf")).then((data) => ({
      name: "Mono",
      data,
      weight: 400 as const,
    })),
    readFile(join(FONTS, "GeistMono-SemiBold.ttf")).then((data) => ({
      name: "Mono",
      data,
      weight: 600 as const,
    })),
  ]);
  return fonts;
};

const signed = (raw: bigint) =>
  `${raw > 0n ? "+" : raw < 0n ? "−" : ""}${formatAmount(raw < 0n ? -raw : raw, 18, 2)}`;
const signColor = (raw: bigint) => (raw > 0n ? C.gain : raw < 0n ? C.loss : C.head);

export async function GET(_request: Request, ctx: { params: Promise<{ address: string; week: string }> }) {
  const { address: rawAddress, week } = await ctx.params;
  const address = normalizeAddress(decodeURIComponent(rawAddress));
  const start = weekStartSec(week);
  if (!address || start === null) return new Response("invalid address or week", { status: 400 });

  const r = await accountService.getWeekly(address, week);
  const weekLabel = new Date(start * 1000).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const leak = r.topLeak
    ? `biggest leak: ${r.topLeak.title.toLowerCase()} −${formatAmount(r.topLeak.amountRaw, 18, 2)}`
    : "no leaks this week";
  const cells: [string, string, string][] = [
    ["Trades", String(r.tradeCount), C.head],
    ["Win rate", `${r.winRatePct}%`, C.head],
    ["Funding", signed(-r.fundingPaidRaw), signColor(-r.fundingPaidRaw)],
    ["No stop", `${r.tradesWithoutStopPct}%`, C.head],
  ];

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: C.bg,
        color: C.text,
        fontFamily: "Geist",
        padding: "60px 66px",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          right: -120,
          top: -200,
          width: 520,
          height: 1000,
          transform: "rotate(18deg)",
          background: "linear-gradient(180deg, rgba(32,204,255,0.12), rgba(32,204,255,0))",
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", fontFamily: "Mono", fontWeight: 600, fontSize: 36, color: C.head }}>
          perp<span style={{ color: C.brand }}>log</span>
        </div>
        <div style={{ display: "flex", fontSize: 22, color: C.muted, letterSpacing: 1 }}>
          {`WEEK OF ${weekLabel.toUpperCase()} · DREAMDEX PERPS`}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 40 }}>
        <div style={{ display: "flex", fontSize: 22, color: C.muted, letterSpacing: 1 }}>
          TRUE NET PNL THIS WEEK
        </div>
        <div style={{ display: "flex", alignItems: "baseline", marginTop: 8 }}>
          <span
            style={{
              fontFamily: "Mono",
              fontWeight: 600,
              fontSize: 112,
              letterSpacing: -4,
              color: signColor(r.netPnlRaw),
            }}
          >
            {signed(r.netPnlRaw)}
          </span>
          <span style={{ fontSize: 34, color: C.muted, marginLeft: 18 }}>USDso</span>
        </div>
        <div style={{ display: "flex", fontSize: 26, marginTop: 16 }}>
          App showed&nbsp;
          <span style={{ fontFamily: "Mono", fontWeight: 600, color: signColor(r.realizedPnlRaw) }}>
            {signed(r.realizedPnlRaw)}
          </span>
          &nbsp;realized · {leak}
        </div>
      </div>
      <div style={{ display: "flex", marginTop: "auto", gap: 24 }}>
        {cells.map(([label, value, color]) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ display: "flex", fontSize: 20, color: C.muted, letterSpacing: 1 }}>
              {label.toUpperCase()}
            </div>
            <div style={{ display: "flex", fontFamily: "Mono", fontSize: 36, color, marginTop: 6 }}>
              {value}
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 20,
          color: C.muted,
          marginTop: 26,
        }}
      >
        <span>
          {r.reconciled ? "Reconciled to on-chain balance" : "Rebuilt from on-chain history"} · Somnia testnet
        </span>
        <span>{`perplog · ${shortAddress(address)}`}</span>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts: await loadFonts(),
      headers: { "Cache-Control": "public, max-age=300" },
    },
  );
}
