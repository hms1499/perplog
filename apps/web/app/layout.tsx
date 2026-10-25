import type { Metadata } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import Link from "next/link";
import { Providers } from "./providers";
import "./globals.css";

const schibsted = Schibsted_Grotesk({ variable: "--font-schibsted", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PerpLog",
  description: "Your true perps PnL on dreamDEX, after funding and liquidation fees.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${schibsted.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="border-rule border-b">
          <div className="mx-auto flex max-w-5xl items-baseline justify-between px-4 py-4 sm:px-6">
            <Link href="/" className="font-extrabold text-lg tracking-tight">
              PerpLog
            </Link>
            <span className="text-muted text-sm">For dreamDEX perps on Somnia Tokyo testnet</span>
          </div>
        </header>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
