import { ArrowDown, ArrowUp, Radar } from "lucide-react";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { ApiError, errorMessage } from "../../app/core/api";
import { fmt } from "../../app/core/format";
import { profile, useIsProfiled } from "../../app/core/profile";
import { sfx } from "../../app/core/sound";
import { Button, Empty, Panel, Scanning, Tag } from "../../app/ui";
import { Constellation } from "./Constellation";
import { sweepNetwork, useDeviceStore, useDevices } from "./client";
import { KIND_LABEL, deviceTitle } from "./labels";
import type { NetDevice, NetDevices } from "./types";

type SortKey = "name" | "kind" | "vendor" | "ip" | "mac";

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: "name", label: "Name", className: "net-col-name" },
  { key: "kind", label: "Kind", className: "net-col-kind" },
  { key: "vendor", label: "Vendor", className: "net-col-vendor" },
  { key: "ip", label: "IP address", className: "net-col-ip" },
  { key: "mac", label: "MAC address", className: "net-col-mac" },
];

const ipValue = (ip: string): number => ip.split(".").reduce((n, p) => n * 256 + Number(p), 0);

function compare(key: SortKey, a: NetDevice, b: NetDevice): number {
  switch (key) {
    case "name":
      return deviceTitle(a).localeCompare(deviceTitle(b), "en", { numeric: true });
    case "kind":
      return KIND_LABEL[a.kind].localeCompare(KIND_LABEL[b.kind]);
    case "vendor":
      return (a.vendor ?? "￿").localeCompare(b.vendor ?? "￿");
    case "ip":
      return ipValue(a.ip) - ipValue(b.ip);
    case "mac":
      return a.mac.localeCompare(b.mac);
  }
}

type Sweep = { state: "idle" } | { state: "asking" } | { state: "running" } | { state: "done"; swept: number; found: number } | { state: "failed"; message: string };

export function DevicesTab(): ReactElement {
  const poll = useDevices();
  const latest = useDeviceStore((s) => s.latest);
  const setLatest = useDeviceStore((s) => s.set);
  const [hovered, setHovered] = useState<string | null>(null);
  const [sweep, setSweep] = useState<Sweep>({ state: "idle" });

  useEffect(() => {
    if (poll.data) setLatest(poll.data);
  }, [poll.data, setLatest]);

  const runSweep = async (): Promise<void> => {
    const before = latest?.devices.length ?? 0;
    setSweep({ state: "running" });
    try {
      const result = await sweepNetwork();
      setLatest(result);
      setSweep({ state: "done", swept: result.swept, found: Math.max(0, result.devices.length - before) });
      sfx.lock();
    } catch (err) {
      setSweep({ state: "failed", message: err instanceof ApiError ? err.message : errorMessage(err) });
    }
  };

  if (!latest) {
    return (
      <Panel>
        {poll.error ? (
          <Empty title="Devices unavailable" tone="error" action={<Button onClick={poll.refresh}>Try again</Button>}>
            {errorMessage(poll.error)}
          </Empty>
        ) : (
          <Scanning label="Listening for devices, about 8 s" />
        )}
      </Panel>
    );
  }

  return (
    <div className="v-grid">
      <Panel
        title="Your network"
        actions={
          <Button size="sm" icon={<Radar size={13} />} onClick={() => setSweep({ state: "asking" })} disabled={sweep.state === "running" || sweep.state === "asking"}>
            Find quiet devices
          </Button>
        }
      >
        {sweep.state !== "idle" && (
          <div className="net-sweep" role="status">
            {sweep.state === "asking" && (
              <>
                <p>Sends one ping to each address on your network so quiet devices answer.</p>
                <div className="net-sweep__actions">
                  <Button variant="primary" size="sm" onClick={() => void runSweep()}>
                    Send pings
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSweep({ state: "idle" })}>
                    Cancel
                  </Button>
                </div>
              </>
            )}
            {sweep.state === "running" && <Scanning label="Pinging every address, about 15 s" />}
            {sweep.state === "done" && (
              <>
                <p>
                  Pinged {fmt.int(sweep.swept)} addresses. {sweep.found > 0 ? `${sweep.found} more ${sweep.found === 1 ? "device" : "devices"} answered.` : "No new devices answered."}
                </p>
                <Button size="sm" variant="ghost" onClick={() => setSweep({ state: "idle" })}>
                  Dismiss
                </Button>
              </>
            )}
            {sweep.state === "failed" && (
              <>
                <p className="alarm">{sweep.message}</p>
                <Button size="sm" variant="ghost" onClick={() => setSweep({ state: "idle" })}>
                  Dismiss
                </Button>
              </>
            )}
          </div>
        )}
        <Constellation devices={latest.devices} hovered={hovered} onHover={setHovered} />
        <Caption devices={latest} hovered={hovered} />
      </Panel>

      <DeviceList devices={latest.devices} hovered={hovered} onHover={setHovered} />
    </div>
  );
}

function Caption({ devices, hovered }: { devices: NetDevices; hovered: string | null }): ReactElement {
  const d = devices.devices.find((x) => x.id === hovered);
  return (
    <div className="net-chart__caption" aria-live="polite">
      {d
        ? [deviceTitle(d), KIND_LABEL[d.kind], d.vendor, d.ip, d.randomized ? "private address" : null].filter(Boolean).join(" · ")
        : `${devices.devices.length} ${devices.devices.length === 1 ? "device" : "devices"}${devices.subnet ? ` on ${devices.subnet}` : ""}. Click one to profile it. ${devices.bonjour ? "Names come from Bonjour announcements and your router." : "Bonjour is unavailable, so names are limited to what your router knows."}`}
    </div>
  );
}

function DeviceList({ devices, hovered, onHover }: { devices: NetDevice[]; hovered: string | null; onHover: (id: string | null) => void }): ReactElement {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "ip", dir: 1 });
  const rows = useMemo(() => [...devices].sort((a, b) => compare(sort.key, a, b) * sort.dir), [devices, sort]);

  return (
    <Panel title="All devices" flush>
      <div className="net-devrow net-devrow--head" role="row">
        {COLUMNS.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`net-sort ${c.className}${sort.key === c.key ? " net-sort--on" : ""}`}
            aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
            onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : 1 }))}
          >
            {c.label}
            {sort.key === c.key && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
          </button>
        ))}
      </div>
      <ul>
        {rows.map((d) => (
          <Row key={d.id} d={d} hovered={hovered === d.id} onHover={onHover} />
        ))}
      </ul>
    </Panel>
  );
}

function Row({ d, hovered, onHover }: { d: NetDevice; hovered: boolean; onHover: (id: string | null) => void }): ReactElement {
  const selected = useIsProfiled("device", d.id);
  return (
    <li>
      <button
        type="button"
        className={`v-row net-devrow${hovered ? " net-devrow--hover" : ""}`}
        aria-selected={selected}
        onClick={() => profile.open({ kind: "device", id: d.id, data: d })}
        onPointerEnter={() => onHover(d.id)}
        onPointerLeave={() => onHover(null)}
      >
        <span className="net-col-name">
          <span className="net-devrow__title">{deviceTitle(d)}</span>
          {d.isThisMac && <Tag tone="ice">This Mac</Tag>}
          {d.isGateway && <Tag tone="ice">Gateway</Tag>}
        </span>
        <span className="net-col-kind dim">{KIND_LABEL[d.kind]}</span>
        <span className="net-col-vendor dim">{d.vendor ?? "—"}</span>
        <span className="net-col-ip num">{d.ip}</span>
        <span className="net-col-mac num">
          {d.mac}
          {d.randomized && <Tag>Private address</Tag>}
        </span>
      </button>
    </li>
  );
}
