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

/** A stop gives up (FAILED) after this many failed close attempts... */
export const STOP_MAX_ATTEMPTS = 5;
/** ...or this long after it triggered, whichever comes first. */
export const STOP_GIVE_UP_MS = 15_000;
/** Close slippage on the first attempt, then growing by the step up to the cap. */
export const CLOSE_SLIP_START_BPS = 150;
export const CLOSE_SLIP_STEP_BPS = 100;
export const CLOSE_SLIP_MAX_BPS = 500;
/** An opened or enlarged position without an armed stop alerts after this long. */
export const UNPROTECTED_GRACE_SEC = 60;
/** Fallback indexer poll interval while Reactivity is degraded. */
export const UNPROTECTED_POLL_SEC = 30;
export const MARK_POLL_MS = 1_000;
/** Postgres advisory lock id: only one worker signs at a time. */
export const SIGNER_LOCK_ID = 7331;
/** Plan & Place entry: IOC price bound around the reference price. */
export const ENTRY_SLIP_BPS = 50;
/** A queued plan entry older than this is failed `expired`, never sent. */
export const ENTRY_MAX_AGE_MS = 30_000;
