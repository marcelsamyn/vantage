import type { MdnsService } from "../../server/kit";
import { isPrivateIpv4 } from "../net/devices.server";
import type { Driver, Endpoint, Sighting } from "./driver.server";
import { createLimiter } from "./limits.server";

/**
 * Anyone on the network can announce any number of services. These limits keep one noisy or hostile host from
 * making a scan spawn thousands of lookups or fill the store.
 */
export const MAX_SIGHTINGS_PER_DRIVER = 32;
export const MAX_PARALLEL = 4;

/**
 * Turn announced services into endpoints. Each driver looks at its first `MAX_SIGHTINGS_PER_DRIVER` services, and at
 * most `MAX_PARALLEL` host names are resolved at a time. Only private addresses count: VANTAGE never follows an
 * announcement out to the internet.
 */
export async function discoverFrom(drivers: readonly Driver[], services: readonly MdnsService[], addressesOf: (host: string) => Promise<string[]>): Promise<Endpoint[]> {
  const networked = drivers.filter((d) => d.mdns?.length);
  const perDriver = networked.map((d) => ({ driver: d, services: services.filter((s) => d.mdns?.includes(s.type)).slice(0, MAX_SIGHTINGS_PER_DRIVER) }));

  const limit = createLimiter(MAX_PARALLEL);
  const hosts = [...new Set(perDriver.flatMap((p) => p.services.map((s) => s.host)))];
  const addressOf = new Map(await Promise.all(hosts.map((host) => limit(async () => [host, (await addressesOf(host)).find(isPrivateIpv4)] as const))));

  const found = await Promise.all(
    perDriver.map(({ driver, services: own }) => {
      const sightings: Sighting[] = own.flatMap((s) => {
        const ip = addressOf.get(s.host);
        return ip ? [{ ...s, ip }] : [];
      });
      return driver.discover(sightings);
    }),
  );
  return found.flat();
}
