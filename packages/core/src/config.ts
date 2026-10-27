export const LIQ_DISTANCE_WARN_BPS = 1000;
export const TILT_WINDOW_SEC = 1800;
export const TILT_MULTIPLE_NUM = 3n;
export const TILT_MULTIPLE_DEN = 2n;
export const HISTORY_MAX_CHANGES = 20_000;
/** 0.01 USDso. */
export const RECONCILE_TOLERANCE_RAW = 10n ** 16n;
export const COHORT_MAX_CHANGES = 6;
/** 1 USDso. */
export const COHORT_MAX_ABS_PNL_RAW = 10n ** 18n;
/** Enough for a smooth chart, small enough for a heavy account's payload. */
export const EQUITY_MAX_POINTS = 500;
/** Prices and USDso amounts are 18-decimal fixed point. */
export const PRICE_DECIMALS = 18;
/** Display precision for pools missing from the market list. */
export const FALLBACK_DISPLAY_DECIMALS = 4;
