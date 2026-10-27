import { HIDEKI, withOverrides } from "../src/networks";

describe("withOverrides", () => {
  test("replaces only the given endpoints", () => {
    const n = withOverrides(HIDEKI, { indexer: "http://x" });
    expect(n.indexer).toBe("http://x");
    expect(n.rpcHttp).toBe(HIDEKI.rpcHttp);
    expect(n.rpcWs).toBe(HIDEKI.rpcWs);
  });

  test("ignores undefined overrides", () => {
    const n = withOverrides(HIDEKI, { rpcHttp: undefined, rpcWs: "ws://y" });
    expect(n.rpcHttp).toBe(HIDEKI.rpcHttp);
    expect(n.rpcWs).toBe("ws://y");
  });
});
