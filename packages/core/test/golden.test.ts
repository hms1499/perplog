import { readdirSync, readFileSync } from "node:fs";
import { readFixture } from "../src/fixture";
import { reconcile } from "../src/reconcile";

const dir = new URL("./fixtures/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

test("at least 8 golden fixtures exist", () => {
  expect(files.length).toBeGreaterThanOrEqual(8);
});

test.each(files)("reconciles %s exactly", (file) => {
  const fixture = readFixture(readFileSync(new URL(file, dir), "utf8"));
  const result = reconcile(fixture.history, fixture.collateralRaw);
  expect(result.ok, `delta ${result.deltaRaw}`).toBe(true);
});
