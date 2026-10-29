import type { AddressInfo } from "node:net";
import { startHealthServer } from "../src/health";
import { fakeLogger } from "./fakes";

async function withServer(run: (base: string) => Promise<void>): Promise<void> {
  const server = await startHealthServer(0, fakeLogger());
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await server.close();
  }
}

test("the health server answers GET and HEAD on any path with a bare 200 ok", async () => {
  await withServer(async (base) => {
    for (const path of ["/", "/healthz"]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    }
    const head = await fetch(base, { method: "HEAD" });
    expect(head.status).toBe(200);
  });
});

test("the health server rejects other methods", async () => {
  await withServer(async (base) => {
    const res = await fetch(base, { method: "POST", body: "x" });
    expect(res.status).toBe(405);
  });
});

test("close() frees the port", async () => {
  const server = await startHealthServer(0, fakeLogger());
  const { port } = server.address() as AddressInfo;
  await server.close();
  await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
});
