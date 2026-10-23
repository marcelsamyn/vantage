import { Map as MapIcon, Route } from "lucide-react";
import type { ReactElement } from "react";
import { go } from "../../app/core/nav";
import type { ProfilerProps } from "../../app/core/plugin";
import { Button, ProfilerCard } from "../../app/ui";
import { showLayer } from "../city/client";
import { traceTo } from "./actions";
import { useConnections } from "./client";
import { hostFact } from "./facts";
import { organisation, placeLabel } from "./model";
import { portInfo } from "./ports";
import type { WireHost } from "./types";

/** Profiler for one remote address: who runs it, where it is, and which of your apps talk to it. */
export default function HostProfile({ entity, onClose }: ProfilerProps<"host">): ReactElement {
  const poll = useConnections(8000);
  const latest = poll.data?.hosts.find((h) => h.ip === entity.data.ip);
  // Keep the last known details when the connection has closed, and say so.
  const host: WireHost = latest ?? entity.data;
  const closed = poll.data !== undefined && latest === undefined;
  const org = organisation(host);
  const geo = host.geo;
  const sameOrg = poll.data ? poll.data.hosts.filter((h) => h.ip !== host.ip && h.scope === "public" && organisation(h).key === org.key).length : 0;
  const publicHost = host.scope === "public";

  const apps = (
    <span className="wire-profile-apps">
      {host.processes.map((p) => (
        <span key={p.name}>
          {p.name} <span className="wire-profile-apps__ports">{p.ports.map(portLabel).join(", ")}</span>
        </span>
      ))}
    </span>
  );

  return (
    <ProfilerCard
      band={host.scope === "loopback" ? "This Mac" : host.scope === "private" ? "Local network address" : "Remote server"}
      tone={publicHost ? "sodium" : "ice"}
      name={publicHost ? org.label : (host.rdns ?? host.ip)}
      kicker={geo ? placeLabel(geo) : host.ip}
      onClose={onClose}
      rows={[
        ["Address", host.ip],
        host.rdns && ["Reverse DNS", host.rdns],
        geo?.isp && ["Organisation", geo.isp],
        geo?.as && ["Network", geo.as],
        geo && ["Location", placeLabel(geo)],
        publicHost && !geo && ["Location", "Not available"],
        ["Your apps", closed ? "No open connection now" : apps],
        ["Connections", closed ? "0" : String(host.connections)],
        host.service && ["Used for", host.service],
        sameOrg > 0 && ["Same organisation", `${sameOrg} other ${sameOrg === 1 ? "address" : "addresses"} in use`],
      ]}
      fact={hostFact(host)}
      actions={
        publicHost && (
          <>
            {geo && (
              <Button
                size="sm"
                icon={<MapIcon size={13} />}
                onClick={() => {
                  showLayer("wire.connections");
                  go("city", { action: "fly", arg: `${geo.lat},${geo.lon},4` });
                }}
              >
                Show on the map
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<Route size={13} />} onClick={() => traceTo(host.ip)}>
              Trace route
            </Button>
          </>
        )
      }
      source="Your open connections via lsof · locations from GeoJS"
    />
  );
}

function portLabel(port: number): string {
  const info = portInfo(port);
  return info && !info.temporary ? `${port} ${info.name}` : String(port);
}
