import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Footer, Wordmark } from "./ui";

/** Top bar and footer for the pages outside an account: home, evidence, how it works, shared reports. */
export function SiteChrome({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-line border-b bg-page/95 backdrop-blur">
        <nav className="mx-auto flex h-14 w-full max-w-[1200px] items-center gap-4 px-4 sm:px-6">
          <Wordmark />
          <Badge tone="testnet">Testnet</Badge>
          <div className="flex-1" />
          <div className="flex gap-5 text-[13px] text-muted">
            <Link href="/evidence" className="hover:text-head">
              Evidence
            </Link>
            <Link href="/how-it-works" className="hover:text-head">
              How it works
            </Link>
          </div>
        </nav>
      </header>
      <div className="mx-auto w-full max-w-[1200px] flex-1 px-4 sm:px-6">{children}</div>
      <Footer />
    </div>
  );
}
