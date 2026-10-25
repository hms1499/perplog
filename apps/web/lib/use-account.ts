"use client";

import type { Range } from "@perplog/core";
import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

export function useAccountQuery<T>(address: string, resource: string, params: Record<string, string> = {}) {
  const search = new URLSearchParams(params).toString();
  const path = `/api/accounts/${address}/${resource}${search ? `?${search}` : ""}`;
  return useQuery({ queryKey: [address, resource, params], queryFn: () => getJson<T>(path) });
}

export const RANGES: { value: Range; label: string }[] = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "all", label: "All" },
];

export function parseRange(value: string | null): Range {
  return value === "30d" || value === "all" ? value : "7d";
}
