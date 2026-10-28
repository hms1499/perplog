import Link from "next/link";
import { SiteChrome } from "@/components/site-chrome";

export default function NotFound() {
  return (
    <SiteChrome>
      <main className="py-16">
        <h1 className="font-semibold text-head text-xl">This page does not exist.</h1>
        <p className="mt-2 text-muted">Check the address, or start again from an account.</p>
        <Link href="/" className="mt-6 inline-block text-brand hover:underline">
          Analyze an account
        </Link>
      </main>
    </SiteChrome>
  );
}
