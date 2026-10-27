import { fileURLToPath } from "node:url";

/** Absolute path of the generated SQL migrations, independent of the CWD. */
export function migrationsFolder(): string {
  return fileURLToPath(new URL("../migrations", import.meta.url));
}
