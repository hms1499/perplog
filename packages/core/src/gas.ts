export type TopUpPlan = { action: "none" } | { action: "send"; amountWei: bigint } | { action: "capped" };

/** Top up a bot key below the threshold, never beyond its daily cap. */
export function planTopUp(input: {
  balanceWei: bigint;
  sentTodayWei: bigint;
  thresholdWei: bigint;
  amountWei: bigint;
  dailyCapWei: bigint;
}): TopUpPlan {
  const { balanceWei, sentTodayWei, thresholdWei, amountWei, dailyCapWei } = input;
  if (balanceWei >= thresholdWei) return { action: "none" };
  const room = dailyCapWei - sentTodayWei;
  if (room <= 0n) return { action: "capped" };
  // biome-ignore lint/complexity/useMathMinMax: Math.min does not accept bigint
  return { action: "send", amountWei: amountWei < room ? amountWei : room };
}
