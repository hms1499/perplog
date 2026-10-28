import type { Metadata } from "next";
import { EvidenceTable } from "@/components/evidence-table";
import { SiteChrome } from "@/components/site-chrome";

export const metadata: Metadata = {
  title: "Evidence · PerpLog",
  description: "Every order PerpLog's bots sent on Somnia Tokyo testnet, with explorer links.",
};

export default function EvidencePage() {
  return (
    <SiteChrome>
      <main className="pb-16">
        <EvidenceTable />
      </main>
    </SiteChrome>
  );
}
