"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * Whether this deployment has a database, so Protect and Watch can work. Without DATABASE_URL every protection
 * route answers 503 db_unavailable; any other answer (401 without a session included) means available.
 */
export function useProtectionAvailable(): boolean {
  const probe = useQuery({
    queryKey: ["protection-available"],
    queryFn: async () => (await fetch("/api/session")).status !== 503,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return probe.data === true;
}
