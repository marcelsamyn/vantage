import { defineSource, json, memo, ndjson } from "../../server/kit";
import { readConnections, readListening } from "./connections.server";
import { parseHost, resolveHost, traceRoute } from "./trace.server";
import type { WireConnections, WireListening } from "./types";

/** Mounted automatically at /api/wire/… Everything here describes this Mac's own traffic. */
export default defineSource({
  probes: [{ name: "Wire · IP locations (GeoJS)", url: "https://get.geojs.io/v1/ip/geo/8.8.8.8.json" }],
  routes: {
    "GET /connections": async () => json(await memo("wire:connections", 5000, readConnections) satisfies WireConnections),

    "GET /listening": async () => json(await memo("wire:listening", 5000, readListening) satisfies WireListening),

    "GET /trace": async (req) => {
      const host = parseHost(req);
      const ip = await resolveHost(host);
      return ndjson(traceRoute(host, ip));
    },
  },
});
