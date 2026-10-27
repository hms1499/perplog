import { defineProject } from "vitest/config";

export default defineProject({ test: { name: "db", globals: true, testTimeout: 30_000 } });
