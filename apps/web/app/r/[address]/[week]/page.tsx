import { normalizeAddress, shortAddress, weekStartSec } from "@perplog/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SiteChrome } from "@/components/site-chrome";

type Params = Promise<{ address: string; week: string }>;

async function parse(params: Params) {
  const { address: raw, week } = await params;
  const address = normalizeAddress(decodeURIComponent(raw));
  return address && weekStartSec(week) !== null ? { address, week } : null;
}

/** The link shared on X: its og:image is the weekly report card. */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const p = await parse(params);
  if (!p) return {};
  const image = `/api/og/report/${p.address}/${p.week}`;
  const title = `Week of ${p.week} · ${shortAddress(p.address)} on PerpLog`;
  const description =
    "True net PnL on dreamDEX perps after funding and liquidation fees, reconciled on-chain.";
  return {
    title,
    description,
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

async function SharedReport({ params }: { params: Params }) {
  const p = await parse(params);
  if (!p) notFound();
  return (
    <>
      {/* biome-ignore lint/performance/noImgElement: the OG route already returns a sized PNG */}
      <img
        src={`/api/og/report/${p.address}/${p.week}`}
        alt={`Weekly report for ${shortAddress(p.address)}, week of ${p.week}`}
        width={1200}
        height={630}
        className="h-auto w-full rounded-xl border border-line"
      />
      <Link
        href={`/a/${p.address}`}
        className="justify-self-start rounded-lg bg-action px-3 py-2 font-semibold text-[13px] text-action-ink hover:bg-action-hover"
      >
        See the full journal on PerpLog
      </Link>
    </>
  );
}

export default function SharedReportPage({ params }: { params: Params }) {
  return (
    <SiteChrome>
      <main className="mx-auto grid w-full max-w-3xl gap-4 py-8">
        <Suspense fallback={<p className="text-muted">Loading report…</p>}>
          <SharedReport params={params} />
        </Suspense>
      </main>
    </SiteChrome>
  );
}
