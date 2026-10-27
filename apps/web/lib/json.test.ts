import { json } from "./json";

test("json keeps headers passed as a Headers instance and serializes bigints", async () => {
  const res = json({ n: 5n }, { status: 201, headers: new Headers({ "cache-control": "no-store" }) });
  expect(res.status).toBe(201);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("content-type")).toBe("application/json");
  expect(await res.json()).toEqual({ n: "5" });
});
