import type { ReactElement } from "react";
import { go } from "../../app/core/nav";
import { usePoll } from "../../app/core/hooks";
import { Page, Panel, Empty, Scanning, Button } from "../../app/ui";
import { showLayer } from "../city/client";
import { fetchTrafficConfig } from "./client";
import { TRAFFIC_SOURCES } from "./types";
import "./traffic.css";
export default function TrafficScreen(): ReactElement {
  const { data, error, loading } = usePoll(fetchTrafficConfig, 60_000, []);
  return (
    <Page
      title="Traffic"
      eyebrow="Road conditions"
      lede="Road incidents, closures and works in the current map view."
    >
      <Panel title="Show traffic on the City map">
        <div className="traffic-actions">
          <Button onClick={() => go("city")}>Open City map</Button>
          <Button onClick={() => showLayer("traffic.routes")}>
            Show road disruption paths
          </Button>
          <Button onClick={() => showLayer("traffic.flow")}>
            Show traffic flow
          </Button>
        </div>
        <p className="traffic-note">
          Enable Road disruptions in the layer panel to show point reports. Only
          current events appear on the map. Select a marker or path to read its
          report. Traffic flow colors show speed relative to an unobstructed
          road: green is faster, orange and red are slower.
        </p>
      </Panel>
      <Panel title="TomTom coverage">
        {loading && !data ? (
          <Scanning label="Checking traffic configuration" />
        ) : error ? (
          <Empty title="Traffic configuration could not load">
            {error.message}
          </Empty>
        ) : data?.tomtom ? (
          <p className="traffic-note">
            A server key is configured. TomTom incidents and flow are available
            where its Traffic API has coverage. Zoom in if the map covers more
            than 10,000 km².
          </p>
        ) : (
          <p className="traffic-note">
            Create a Traffic API key at{" "}
            <a
              href="https://developer.tomtom.com/"
              target="_blank"
              rel="noreferrer"
            >
              TomTom Developer
            </a>
            . Add <code>VANTAGE_TOMTOM_KEY=your-key</code> to the server’s{" "}
            <code>.env</code>, then restart VANTAGE. The key stays on the
            server.
          </p>
        )}
      </Panel>
      <Panel title="Regional feeds">
        <p className="traffic-note">
          These feeds work without a key. Coverage is limited to each source’s
          area. France covers the non-concession national road network. A source
          with no current reports leaves the map empty.
        </p>
        <div className="traffic-sources">
          {TRAFFIC_SOURCES.filter((s) => s.id !== "tomtom").map((s) => (
            <a key={s.id} href={s.url} target="_blank" rel="noreferrer">
              <span>{s.title}</span>
              <small>
                {s.credit} · refresh {s.refreshMs / 60_000} min
              </small>
            </a>
          ))}
        </div>
      </Panel>
    </Page>
  );
}
