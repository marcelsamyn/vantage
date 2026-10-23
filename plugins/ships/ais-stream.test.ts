import { afterEach, describe, expect, test } from "bun:test";
import { AisStream } from "./ais-stream";

/** The stream is tested against a real TCP server on localhost that plays the part of the Norwegian feed. */

const POSITION = "!AIVDM,1,1,,B,15N4cJ`005Jrek0H@9n`DW5608EP,0*13"; // MMSI 367078250 off Boston
const NAME_1 = "!AIVDM,2,1,1,A,55?MbV02;H;s<HtKR20EHE:0@T4@Dn2222222216L961O5Gf0NSQEp6ClRp8,0*1C";
const NAME_2 = "!AIVDM,2,2,1,A,88888888880,2*25";

interface Fake {
  port: number;
  connections: () => number;
  closed: () => number;
  stop: () => void;
}

function fakeFeed(lines: string[]): Fake {
  let opened = 0;
  let closed = 0;
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        opened++;
        socket.write(`${lines.join("\r\n")}\r\n`);
      },
      data() {},
      close() {
        closed++;
      },
    },
  });
  return { port: server.port, connections: () => opened, closed: () => closed, stop: () => server.stop(true) };
}

const until = async (done: () => boolean, ms = 3000): Promise<void> => {
  const end = Date.now() + ms;
  while (!done() && Date.now() < end) await Bun.sleep(10);
  if (!done()) throw new Error("condition not met in time");
};

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()?.();
});

describe("AisStream", () => {
  test("opens on the first request, keeps the latest position and static data per vessel", async () => {
    const feed = fakeFeed([POSITION, NAME_1, NAME_2]);
    const stream = new AisStream({ host: "127.0.0.1", port: feed.port, tickMs: 20 });
    cleanup.push(feed.stop, () => stream.dispose());
    expect(stream.state).toBe("idle");
    expect(feed.connections()).toBe(0);

    stream.want();
    await until(() => stream.count === 1);
    expect(stream.state).toBe("connected");
    const boat = stream.find(367078250);
    expect(boat?.position.lat).toBeCloseTo(42.38415, 4);
    expect(boat?.position.sogKt).toBe(0.5);
    expect(stream.within({ west: -72, south: 42, east: -70, north: 43 })).toHaveLength(1);
    expect(stream.within({ west: 10, south: 50, east: 12, north: 52 })).toHaveLength(0);
  });

  test("static data for a vessel with no position yet is kept for when it appears", async () => {
    const feed = fakeFeed([NAME_1, NAME_2]);
    const stream = new AisStream({ host: "127.0.0.1", port: feed.port, tickMs: 20 });
    cleanup.push(feed.stop, () => stream.dispose());
    stream.want();
    await until(() => stream.staticOf(351759000) !== null);
    expect(stream.staticOf(351759000)).toMatchObject({ name: "EVER DIADEM", destination: "NEW YORK" });
    expect(stream.count).toBe(0);
  });

  test("closes the socket when nobody has asked for ships for a while, and opens again on the next request", async () => {
    const feed = fakeFeed([POSITION]);
    const stream = new AisStream({ host: "127.0.0.1", port: feed.port, idleCloseMs: 150, tickMs: 20 });
    cleanup.push(feed.stop, () => stream.dispose());
    stream.want();
    await until(() => stream.state === "connected");
    await until(() => stream.state === "idle", 2000);
    await until(() => feed.closed() === 1);
    expect(feed.connections()).toBe(1);

    stream.want();
    await until(() => feed.connections() === 2);
  });

  test("a request while connected keeps the socket open", async () => {
    const feed = fakeFeed([POSITION]);
    const stream = new AisStream({ host: "127.0.0.1", port: feed.port, idleCloseMs: 200, tickMs: 20 });
    cleanup.push(feed.stop, () => stream.dispose());
    stream.want();
    await until(() => stream.state === "connected");
    for (let i = 0; i < 6; i++) {
      await Bun.sleep(60);
      stream.want();
    }
    expect(stream.state).toBe("connected");
    expect(feed.connections()).toBe(1);
  });

  test("forgets vessels that stopped reporting", async () => {
    const feed = fakeFeed([POSITION]);
    const stream = new AisStream({ host: "127.0.0.1", port: feed.port, staleMs: 100, tickMs: 20, idleCloseMs: 5000 });
    cleanup.push(feed.stop, () => stream.dispose());
    stream.want();
    await until(() => stream.count === 1);
    await until(() => stream.count === 0);
  });

  test("a server that never answers is given up on after the connect timeout", async () => {
    // 192.0.2.1 is reserved for documentation: nothing answers there, or the network refuses at once. Both end as "unreachable".
    const stream = new AisStream({ host: "192.0.2.1", port: 5631, connectTimeoutMs: 200, retryMs: [60_000], tickMs: 20 });
    cleanup.push(() => stream.dispose());
    const started = Date.now();
    stream.want();
    await until(() => stream.state === "unreachable", 2500);
    expect(Date.now() - started).toBeLessThan(2500);
    expect(stream.error).toBeTruthy();
  });

  test("an unreachable server is reported, and the stream retries only while someone is looking", async () => {
    const closedServer = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const port = closedServer.port;
    closedServer.stop(true);
    const problems: string[] = [];
    const stream = new AisStream({ host: "127.0.0.1", port, retryMs: [30], idleCloseMs: 120, tickMs: 20, onProblem: (m) => problems.push(m) });
    cleanup.push(() => stream.dispose());
    stream.want();
    await until(() => stream.state === "unreachable");
    expect(stream.error).toBeTruthy();
    await until(() => problems.length >= 2);
    await until(() => stream.state === "idle", 2000);
  });
});
