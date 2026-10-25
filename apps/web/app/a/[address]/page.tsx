import { normalizeAddress } from "@perplog/core";
import { Suspense } from "react";
import { AccountView } from "@/components/account-view";
import { AddressForm } from "@/components/address-form";

async function Account({ params }: Pick<PageProps<"/a/[address]">, "params">) {
  const { address: raw } = await params;
  const address = normalizeAddress(decodeURIComponent(raw));
  if (!address) {
    return (
      <div className="py-10">
        <p className="mb-6 text-lg">That is not a valid address.</p>
        <AddressForm />
      </div>
    );
  }
  return <AccountView address={address} />;
}

export default function AccountPage({ params }: PageProps<"/a/[address]">) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6">
      <Suspense fallback={<p className="py-10 text-muted">Loading account…</p>}>
        <Account params={params} />
      </Suspense>
    </main>
  );
}
