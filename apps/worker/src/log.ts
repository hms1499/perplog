import pino from "pino";

/** The slice of pino the worker uses; tests substitute a recording fake. */
export interface Logger {
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
}

/** Never pass key material to the logger. */
export function createLogger(level: string): Logger {
  return pino({ level, base: { app: "perplog-worker" } });
}
