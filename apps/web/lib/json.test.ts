import { handleRoute, json } from "./json";

test("json keeps headers passed as a Headers instance and serializes bigints", async () => {
  const res = json({ n: 5n }, { status: 201, headers: new Headers({ "cache-control": "no-store" }) });
  expect(res.status).toBe(201);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("content-type")).toBe("application/json");
  expect(await res.json()).toEqual({ n: "5" });
});

test("handleRoute rethrows Next's prerender interrupt instead of logging it as a 500", async () => {
  const interrupt = Object.assign(new Error("Route /x needs to bail out of prerendering"), {
    digest: "NEXT_PRERENDER_INTERRUPTED",
  });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(
    handleRoute(async () => {
      throw interrupt;
    }),
  ).rejects.toBe(interrupt);
  expect(log).not.toHaveBeenCalled();
  log.mockRestore();
});
