import { createDb } from "../src";

test("createDb attaches a pool error listener so idle-client errors cannot crash the process", async () => {
  const { pool } = createDb("postgres://localhost:1/x");
  try {
    expect(pool.listenerCount("error")).toBe(1);
  } finally {
    await pool.end();
  }
});

test("createDb routes pool errors to the supplied handler", async () => {
  const seen: Error[] = [];
  const { pool } = createDb("postgres://localhost:1/x", (e) => seen.push(e));
  try {
    pool.emit("error", new Error("boom"));
    expect(seen.map((e) => e.message)).toEqual(["boom"]);
  } finally {
    await pool.end();
  }
});
