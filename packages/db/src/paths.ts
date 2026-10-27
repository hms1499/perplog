import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Absolute path of the generated SQL migrations, independent of the CWD.
 * Built with path.join rather than `new URL("../migrations", import.meta.url)`: bundlers (Next/Turbopack)
 * resolve that URL form as an asset import and fail, and the web app never runs migrations anyway.
 */
export function migrationsFolder(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
}
