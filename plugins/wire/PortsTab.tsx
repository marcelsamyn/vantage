import { useMemo, useState, type ReactElement } from "react";
import { errorMessage } from "../../app/core/api";
import { Button, Empty, Meter, Panel, Scanning, Segmented, Stat, Tag } from "../../app/ui";
import { useListening } from "./client";
import { appName } from "./model";
import type { ListeningSocket } from "./types";

type Filter = "all" | "reachable";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "reachable", label: "Reachable" },
] as const satisfies readonly { value: Filter; label: string }[];

const boundTo = (s: ListeningSocket): string => (s.address === "*" ? "Every interface" : s.address);

export function PortsTab(): ReactElement {
  const poll = useListening();
  const [filter, setFilter] = useState<Filter>("all");
  const sockets = poll.data?.sockets;
  const reachable = useMemo(() => sockets?.filter((s) => s.exposed).length ?? 0, [sockets]);
  const shown = useMemo(() => (filter === "reachable" ? sockets?.filter((s) => s.exposed) : sockets) ?? [], [sockets, filter]);

  if (!sockets) {
    return (
      <Panel>
        {poll.error ? (
          <Empty title="Open ports unavailable" tone="error" action={<Button onClick={poll.refresh}>Try again</Button>}>
            {errorMessage(poll.error)}
          </Empty>
        ) : (
          <Scanning label="Listing the ports your apps have opened" />
        )}
      </Panel>
    );
  }

  return (
    <div className="wire-stack">
      <div className="wire-hero wire-hero--ports">
        <div className="wire-values">
          <Stat size="lg" label="Reachable from your network" value={reachable} tone={reachable > 0 ? "alarm" : "mint"} hint={reachable > 0 ? "of your apps wait for connections from other devices" : "Nothing waits for other devices"} />
          <Stat size="sm" label="Open ports" value={sockets.length} />
          <Meter value={reachable} max={Math.max(1, sockets.length)} tone={reachable > 0 ? "alarm" : "mint"} ticks />
        </div>
        <Panel title="What this means">
          <div className="wire-explain">
            <p>
              <Tag tone="alarm">Reachable from your network</Tag> The app listens on your Wi-Fi or Ethernet, so another device on the same network can try to connect. Your router normally keeps strangers on the internet out.
            </p>
            <p>
              <Tag>This Mac only</Tag> Only apps on this Mac can connect. Development servers and helper tools usually listen like this.
            </p>
            <p>
              To close a reachable port, quit the app that opened it, or turn off the matching service in System Settings → General → Sharing. If you do not recognise the app, search its name before you remove anything.
            </p>
          </div>
        </Panel>
      </div>

      <Panel
        title="Open ports"
        flush
        actions={<Segmented label="Show ports" value={filter} options={FILTERS} onChange={setFilter} />}
      >
        {shown.length === 0 ? (
          <Empty title="No port is reachable from your network">Every port your apps have open accepts connections from this Mac only.</Empty>
        ) : (
          <div className="wire-ports">
            <div className="wire-portrow wire-portrow--head">
              <span>App</span>
              <span>Port</span>
              <span>Bound to</span>
              <span>What it is for</span>
            </div>
            {shown.map((s) => (
              <PortLine key={`${s.process}|${s.protocol}|${s.port}`} socket={s} />
            ))}
          </div>
        )}
      </Panel>

      <p className="wire-note">Only ports opened by your own apps are listed; macOS keeps other users' sockets private.</p>
    </div>
  );
}

function PortLine({ socket: s }: { socket: ListeningSocket }): ReactElement {
  return (
    <div className={`wire-portrow${s.exposed ? " wire-portrow--exposed" : ""}`}>
      <span className="wire-portrow__app" title={s.process}>
        {appName(s.process)}
      </span>
      <span className="wire-portrow__port">
        <span className="num">{s.port}</span>
        <span className="wire-portrow__proto">{s.protocol}</span>
        {s.service && <span className="wire-portrow__service">{s.service}</span>}
      </span>
      <span className="wire-portrow__bound">
        {s.exposed ? <Tag tone="alarm">Reachable from your network</Tag> : <Tag>This Mac only</Tag>}
        <span className="wire-portrow__detail">{boundTo(s)}</span>
      </span>
      <span className="wire-portrow__about">{s.about ?? "No standard meaning is known for this port."}</span>
    </div>
  );
}
