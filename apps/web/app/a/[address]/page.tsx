import { normalizeAddress } from "@perplog/core";
import { Suspense } from "react";
import { AccountView } from "@/components/account-view";
import { AddressForm } from "@/components/address-form";
import { SiteChrome } from "@/components/site-chrome";

async function Account({ params }: Pick<PageProps<"/a/[address]">, "params">) {
  const { address: raw } = await params;
  const address = normalizeAddress(decodeURIComponent(raw));
  if (!address) {
    return (
      <SiteChrome>
        <main className="py-10">
          <p className="mb-6 text-lg">That is not a valid address.</p>
          <AddressForm />
        </main>
      </SiteChrome>
    );
  }
  return <AccountView address={address} />;
}

export default function AccountPage({ params }: PageProps<"/a/[address]">) {
  return (
    <Suspense fallback={<p className="px-4 py-10 text-muted">Loading account…</p>}>
      <Account params={params} />
    </Suspense>
  );
}
