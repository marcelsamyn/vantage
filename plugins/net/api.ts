import { defineSource, describe, json, log, ndjson } from "../../server/kit";
import { listDevices, sweep } from "./devices.server";
import { runSpeedTest } from "./speed.server";
import { defaultRoute, dnsServers, listInterfaces, machineName, readCounters } from "./system.server";
import type { NetOverview, SweepResult, NetDevices, NetCounters, WifiInfo } from "./types";
import { readWifi, summarize, wifiWithin } from "./wifi.server";

/** How long /overview waits for the Wi-Fi report (a scan takes about 5 s) before answering without it. */
const WIFI_WAIT_MS = 400;

/** Mounted automatically at /api/net/… */
export default defineSource({
  probes: [
    { name: "Network · device vendor list (Wireshark)", url: "https://www.wireshark.org/download/automated/data/manuf" },
    { name: "Network · speed test (Cloudflare)", url: "https://speed.cloudflare.com/__down?bytes=0" },
  ],
  routes: {
    "GET /overview": async () => {
      const route = await defaultRoute();
      const [interfaces, dns, hostname, wifi] = await Promise.all([
        listInterfaces(route.interface),
        dnsServers(route.interface),
        machineName(),
        wifiWithin(WIFI_WAIT_MS).catch((err: unknown) => {
          log.warn("wifi report failed", { error: describe(err) });
          return undefined;
        }),
      ]);
      return json({
        hostname,
        interfaces,
        gateway: { ip: route.gateway, interface: route.interface },
        dns,
        wifi: wifi ? summarize(wifi) : null,
        // null means the first scan is still running; undefined means it failed.
        wifiPending: wifi === null,
      } satisfies NetOverview);
    },

    "GET /counters": async () => json((await readCounters()) satisfies NetCounters),

    "GET /wifi": async () => json((await readWifi()) satisfies WifiInfo),

    "GET /devices": async () => json((await listDevices()) satisfies NetDevices),

    "POST /sweep": async () => json((await sweep()) satisfies SweepResult),

    "GET /speed": () => ndjson(runSpeedTest()),
  },
});
