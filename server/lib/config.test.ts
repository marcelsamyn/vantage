import { describe, expect, test } from "bun:test";
import { serverConfig } from "./config";

describe("deployment configuration", () => {
  test("keeps unconfigured and local installations on loopback", () => {
    expect(serverConfig({})).toEqual({ port: 4747, hostname: "127.0.0.1", origin: undefined });
    expect(serverConfig({ VANTAGE_LOCAL: "1", PORT: "4799" }).hostname).toBe("127.0.0.1");
  });

  test("binds a hosted installation and keeps its exact origin", () => {
    expect(serverConfig({ VANTAGE_ORIGIN: "https://vantage.example.com:8443/" })).toEqual({
      port: 4747, hostname: "0.0.0.0", origin: "https://vantage.example.com:8443",
    });
  });

  test("refuses local access on a hosted origin and invalid deployment values", () => {
    for (const env of [
      { VANTAGE_LOCAL: "1", VANTAGE_ORIGIN: "https://vantage.example.com" },
      { VANTAGE_LOCAL: "yes" }, { PORT: "0" }, { PORT: "65536" }, { PORT: "garbage" },
      ...["file:///tmp/vantage", "https://user:pass@example.com", "https://example.com/path", "https://example.com?query", "https://example.com#hash"].map(VANTAGE_ORIGIN => ({ VANTAGE_ORIGIN })),
    ]) expect(() => serverConfig(env)).toThrow();
  });
});
