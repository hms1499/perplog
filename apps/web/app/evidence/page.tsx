import type { Metadata } from "next";
import { EvidenceTable } from "@/components/evidence-table";

export const metadata: Metadata = {
  title: "Evidence · PerpLog",
  description: "Every order PerpLog's bots sent on Somnia Tokyo testnet, with explorer links.",
};

export default function EvidencePage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6">
      <EvidenceTable />
    </main>
  );
}
