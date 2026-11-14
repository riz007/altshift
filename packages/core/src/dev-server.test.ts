import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { startDevServer } from "./dev-server.js";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  await new Promise((done) => server.close(done));
  return port;
}

async function isUp(url: string): Promise<boolean> {
  return fetch(url).then(
    () => true,
    () => false,
  );
}

const serve = (port: number) =>
  `node -e "require('node:http').createServer((q,s)=>s.end('ok')).listen(${port},'127.0.0.1')"`;

describe("startDevServer", () => {
  it("starts the command, waits for the URL, and stops the whole process tree", async () => {
    const port = await freePort();
    const url = `http://127.0.0.1:${port}/`;

    const server = await startDevServer({ command: serve(port), url, readyTimeoutSeconds: 20, cwd: process.cwd() });

    expect(server.ok && server.value.reused).toBe(false);
    expect(await isUp(url)).toBe(true);
    if (server.ok) await server.value.stop();
    expect(await isUp(url)).toBe(false);
  });

  it("reuses a server that is already running and leaves it running", async () => {
    const existing = createServer((_request, response) => response.end("ok"));
    await new Promise<void>((done) => existing.listen(0, "127.0.0.1", done));
    const url = `http://127.0.0.1:${(existing.address() as AddressInfo).port}/`;

    const server = await startDevServer({ command: "exit 1", url, readyTimeoutSeconds: 5, cwd: process.cwd() });

    expect(server.ok && server.value.reused).toBe(true);
    if (server.ok) await server.value.stop();
    expect(await isUp(url)).toBe(true);
    await new Promise((done) => existing.close(done));
  });

  it("fails with the command output when the command exits early", async () => {
    const url = `http://127.0.0.1:${await freePort()}/`;

    const server = await startDevServer({
      command: "echo missing-script >&2; exit 3",
      url,
      readyTimeoutSeconds: 10,
      cwd: process.cwd(),
    });

    expect(!server.ok && server.error.code).toBe("dev-server");
    expect(!server.ok && server.error.message).toContain("exited with code 3");
    expect(!server.ok && server.error.message).toContain("missing-script");
  });

  it("fails and cleans up when the URL never responds", async () => {
    const url = `http://127.0.0.1:${await freePort()}/`;

    const server = await startDevServer({ command: "sleep 30", url, readyTimeoutSeconds: 1, cwd: process.cwd() });

    expect(!server.ok && server.error.message).toContain("did not respond within 1s");
  });
});
