import { createServer, type Server } from "node:http";
import type { Logger } from "./log";

export interface HealthServer {
  address(): ReturnType<Server["address"]>;
  close(): Promise<void>;
}

/**
 * A bare liveness endpoint for hosts that need an open port and an inbound ping to stay awake (Render's free web
 * service). It answers "ok" on any path, active or standby alike: a deploy's new instance waits in standby until
 * the old one releases the signer lock, and it must pass the host's health check meanwhile. It reveals no state.
 */
export function startHealthServer(port: number, log: Logger): Promise<HealthServer> {
  const server = createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" }).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      server.on("error", (err) => log.error({ err }, "health server error"));
      resolve({
        address: () => server.address(),
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
            server.closeAllConnections();
          }),
      });
    });
  });
}
