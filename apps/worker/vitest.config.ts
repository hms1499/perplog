import { defineProject } from "vitest/config";

export default defineProject({ test: { name: "worker", globals: true, testTimeout: 30_000 } });
