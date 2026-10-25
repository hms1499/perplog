import { COHORT_MAX_ABS_PNL_RAW, COHORT_MAX_CHANGES } from "./config";
import { absBig } from "./units";

/** Automated-looking accounts excluded from platform statistics (spec §6.3). */
export function isAutomatedCohort(changeCount: number, realizedPnlRaw: bigint): boolean {
  return changeCount <= COHORT_MAX_CHANGES && absBig(realizedPnlRaw) < COHORT_MAX_ABS_PNL_RAW;
}
