import { expect, test } from "bun:test";
import { aprsLines, loginLine } from "./stream.server";

const box = { west: -73, south: 49, east: -72, north: 50 };

test("receive-only login uses an exact area filter and refuses login injection", () => {
  expect(loginLine("W1AW-1", box)).toBe("user W1AW-1 pass -1 vers VANTAGE 0.1 filter a/50/-73/49/-72\r\n");
  expect(() => loginLine("bad\r\nCALL", box)).toThrow();
  expect(() => loginLine("W1AW-0", box)).toThrow();
  expect(() => loginLine("NOCALLCALL", box)).toThrow();
});

test("waits for identification, writes only login, emits packets and abort closes TCP", async () => {
  let client: Bun.Socket<undefined> | null = null;
  let written = "";
  let closed = false;
  const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: {
    open(socket) { client = socket; },
    data(socket, data) {
      written += data.toString();
      socket.write("# logresp W1AW-1 unverified, server TEST\r\nW1AW>APRS:!4903.50N/07201.75W-Test\r\n");
    },
    close() { closed = true; },
  } });
  const controller = new AbortController();
  const source = aprsLines({ host: "127.0.0.1", port: server.port }, loginLine("W1AW-1", box), controller.signal);
  const iterator = source[Symbol.asyncIterator]();
  try {
    const first = iterator.next();
    await Bun.sleep(20);
    expect(written).toBe("");
    if (!client) throw new Error("No TCP client");
    (client as Bun.Socket<undefined>).write("# TEST APRS server\r\n");
    expect((await first).value).toBe("# TEST APRS server");
    expect((await iterator.next()).value).toContain("logresp");
    expect((await iterator.next()).value).toContain("W1AW>APRS");
    expect(written).toBe(loginLine("W1AW-1", box));
    const pending = iterator.next();
    controller.abort();
    expect((await pending).done).toBe(true);
    for (let i = 0; i < 100 && !closed; i++) await Bun.sleep(5);
    expect(closed).toBe(true);
  } finally { controller.abort(); server.stop(true); }
});

test("iterator cancellation closes even while next is pending; oversized lines fail", async () => {
  const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { open(s) { s.write("# TEST\r\n"); }, data() {} } });
  const controller = new AbortController();
  const iterator = aprsLines({ host: "127.0.0.1", port: server.port }, loginLine("W1AW", box), controller.signal)[Symbol.asyncIterator]();
  try {
    await iterator.next();
    const pending = iterator.next();
    await iterator.return?.();
    expect((await pending).done).toBe(true);
  } finally { controller.abort(); server.stop(true); }

  const broken = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { open(s) { s.write("x".repeat(513)); }, data() {} } });
  try {
    const bad = aprsLines({ host: "127.0.0.1", port: broken.port }, loginLine("W1AW", box), new AbortController().signal)[Symbol.asyncIterator]();
    await expect(bad.next()).rejects.toThrow("512");
  } finally { broken.stop(true); }
});

test("a date-line view subscribes to both halves without widening to the world", () => {
  expect(loginLine("W1AW", { west: 170, east: -170, south: -10, north: 10 })).toBe("user W1AW pass -1 vers VANTAGE 0.1 filter a/10/170/-10/180 a/10/-180/-10/-170\r\n");
});

test("a maximum-size packet survives a split CRLF and pre-aborted streams close without connecting", async () => {
  const line = `W1AW>APRS:>${"x".repeat(499)}`;
  expect(line.length).toBe(510);
  let connected = 0;
  const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: {
    open(socket) { connected++; socket.write("# TEST\r\n"); },
    data(socket) { socket.write(`${line}\r`); setTimeout(() => socket.write("\n"), 10); },
  } });
  const controller = new AbortController();
  try {
    const iterator = aprsLines({ host: "127.0.0.1", port: server.port }, loginLine("W1AW", box), controller.signal)[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toBe("# TEST");
    expect((await iterator.next()).value).toBe(line);
    await iterator.return?.();
    const aborted = new AbortController();
    aborted.abort();
    const cancelled = aprsLines({ host: "127.0.0.1", port: server.port }, loginLine("W1AW", box), aborted.signal)[Symbol.asyncIterator]();
    expect((await cancelled.next()).done).toBe(true);
    await Bun.sleep(20);
    expect(connected).toBe(1);
  } finally { controller.abort(); server.stop(true); }
});
