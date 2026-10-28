import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Footer, NavBar } from "@/components/ui";
import { Providers } from "./providers";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

/** Absolute base for OG/Twitter image URLs: NEXT_PUBLIC_SITE_URL, else Vercel's production host, else local. */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3200");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "PerpLog",
  description: "Your true perps PnL on dreamDEX, after funding and liquidation fees.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <NavBar />
        <div className="flex-1">
          <Providers>{children}</Providers>
        </div>
        <Footer />
      </body>
    </html>
  );
}
