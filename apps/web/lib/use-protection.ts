"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError, getJson } from "./api";

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

export interface SessionState {
  status: "requested" | "pending" | "linked";
  botAddress: string | null;
  account?: string | null;
}

/** This browser's PerpLog session, or null when it has none (401). Only queried when protection is available. */
export function useSessionState(enabled: boolean) {
  return useQuery({
    queryKey: ["session-state"],
    queryFn: async (): Promise<SessionState | null> => {
      try {
        return await getJson<SessionState>("/api/session");
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    enabled,
    staleTime: 0,
  });
}
