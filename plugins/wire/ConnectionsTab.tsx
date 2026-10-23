import { Map as MapIcon } from "lucide-react";
import { useMemo, useState, type ReactElement } from "react";
import { errorMessage } from "../../app/core/api";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import { Button, Empty, LiveDot, Panel, Scanning, Stat } from "../../app/ui";
import { openHost, showConnectionsOnMap } from "./actions";
import { Constellation } from "./Constellation";
import { useConnections, useOrigin } from "./client";
import { appRows, busiestHost, connectionStats, organisationNodes, type AppRow, type Destination } from "./model";

const CHIPS_SHOWN = 4;

/** "Updated 3 s ago", with its own clock so the tick re-renders this text only, not the constellation. */
function Updated({ at }: { at: number }): ReactElement {
  const now = useNow(1000);
  return <>Updated {fmt.ago(at, now)}</>;
}

export function ConnectionsTab(): ReactElement {
  const poll = useConnections();
  const origin = useOrigin();
  const [app, setApp] = useState<string | null>(null);
  const data = poll.data;

  const nodes = useMemo(() => (data ? organisationNodes(data.hosts) : []), [data]);
  const rows = useMemo(() => (data ? appRows(data.hosts) : []), [data]);
  const stats = useMemo(() => (data ? connectionStats(data.hosts) : null), [data]);

  if (!data || !stats) {
    return (
      <Panel>
        {poll.error ? (
          <Empty title="Connections unavailable" tone="error" action={<Button onClick={poll.refresh}>Try again</Button>}>
            {errorMessage(poll.error)}
          </Empty>
        ) : (
          <Scanning label="Reading your open connections" />
        )}
      </Panel>
    );
  }

  if (data.hosts.length === 0) {
    return (
      <Panel>
        <Empty title="No open connections">Your apps have no connection to anything right now. Open a web page or an app that uses the internet and this screen fills in within a few seconds.</Empty>
      </Panel>
    );
  }

  return (
    <div className="wire-stack">
      <div className="wire-hero">
        <div className="wire-values">
          <Stat size="lg" label="Open connections" value={data.total} />
          <Stat size="sm" label="Organisations" value={stats.destinations} hint={stats.local > 0 ? `${stats.local} more stay on this Mac or your network` : undefined} />
          <Stat size="sm" label="Countries" value={stats.countries} />
          <Stat size="sm" label="Apps" value={stats.apps} />
        </div>
        <Panel
          title="Where your Mac connects"
          actions={
            <span className="wire-panel-actions">
              <span className="wire-live">
                <LiveDot tone="sodium" />
                {poll.updatedAt ? <Updated at={poll.updatedAt} /> : "Updating"}
              </span>
              <Button size="sm" icon={<MapIcon size={13} />} onClick={() => showConnectionsOnMap(origin, data.hosts)}>
                Show on the map
              </Button>
            </span>
          }
        >
          {nodes.length > 0 ? (
            <Constellation nodes={nodes} total={data.total} activeApp={app} onOpen={(node) => openHost(busiestHost(node))} />
          ) : (
            <Empty title="Nothing on the internet right now">All {data.total} open connections stay on this Mac or your local network.</Empty>
          )}
        </Panel>
      </div>

      {data.geoNote && <p className="wire-note wire-note--warn">{data.geoNote}</p>}

      <Panel title="Apps and where they connect" flush>
        <div className="wire-apps">
          <div className="wire-approw wire-approw--head">
            <span>App</span>
            <span className="wire-num">Connections</span>
            <span>Connected to</span>
          </div>
          {rows.map((row) => (
            <AppLine key={row.name} row={row} onHover={setApp} />
          ))}
        </div>
      </Panel>

      <p className="wire-note">
        Only connections opened by your own apps are visible here, because macOS keeps other users' and system-wide traffic private. VANTAGE needs no administrator access and never looks inside a connection.
      </p>
      <p className="wire-note">
        Locations come from GeoJS, which receives the remote addresses listed here (never your own) over an encrypted connection. They are approximate, often only the country, and large networks answer from many cities.
      </p>
    </div>
  );
}

function AppLine({ row, onHover }: { row: AppRow; onHover: (app: string | null) => void }): ReactElement {
  const shown = row.destinations.slice(0, CHIPS_SHOWN);
  const more = row.destinations.length - shown.length;
  return (
    <div className="wire-approw" onPointerEnter={() => onHover(row.name)} onPointerLeave={() => onHover(null)}>
      <span className="wire-approw__name">{row.name}</span>
      <span className="wire-num num">{row.connections}</span>
      <span className="wire-chips">
        {shown.map((d) => (
          <Chip key={d.id} dest={d} />
        ))}
        {more > 0 && <span className="wire-more">+{more} more</span>}
      </span>
    </div>
  );
}

function Chip({ dest }: { dest: Destination }): ReactElement {
  const content = (
    <>
      {dest.countryCode && <span className="wire-chip__cc">{dest.countryCode}</span>}
      <span className="wire-chip__label">{dest.label}</span>
      <span className="wire-chip__n num">{dest.connections}</span>
    </>
  );
  const host = dest.host;
  if (!host) return <span className="wire-chip wire-chip--local">{content}</span>;
  return (
    <button type="button" className="wire-chip" onClick={() => openHost(host)} title={`Open the profile of ${dest.label}`}>
      {content}
    </button>
  );
}
