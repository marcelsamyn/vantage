import { Camera, Map as MapIcon, Megaphone, PenLine } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { usePoll, type Polled } from "../../app/core/hooks";
import { profile } from "../../app/core/profile";
import { useSettings } from "../../app/core/settings";
import { Button, Empty, LiveDot, Panel, Scanning, Tag } from "../../app/ui";
import { distanceM, type LatLon } from "../../shared/geo";
import { showLayer } from "../city/client";
import { fetchReportLink, nearest } from "./client";
import { leaveNote } from "./store";
import { CAMERA_NOTE, type NoteList, type OrderList } from "./types";

export function OrdersSection({ here, orders, radiusKm }: { here: LatLon | null; orders: Polled<OrderList>; radiusKm: number }): ReactElement {
  const units = useSettings((s) => s.units);
  const link = usePoll((signal) => (here ? fetchReportLink(here, signal) : Promise.resolve(null)), null, [here ? `${here.lat.toFixed(2)},${here.lon.toFixed(2)}` : "none"], here === null);
  const list = orders.data;
  const rows = list && here ? nearest(list.orders, here, 12) : [];

  return (
    <Panel title="Your city's open work orders">
      <div className="reach-actions">
        {link.data ? (
          <a className="v-btn v-btn--sm v-btn--primary" href={link.data.url} target="_blank" rel="noreferrer noopener" title={`Opens ${link.data.operator}. You send the report there; VANTAGE sends nothing.`}>
            <Megaphone size={13} /> Report a problem here
          </a>
        ) : (
          <Button size="sm" variant="primary" icon={<Megaphone size={13} />} disabled title={link.loading ? "Finding the reporting page" : "No reporting service is known near you"}>
            Report a problem here
          </Button>
        )}
        <Button size="sm" icon={<MapIcon size={13} />} onClick={() => showLayer("reach.orders")}>
          On the map
        </Button>
        {link.data && <span className="reach-actions__note">{link.data.operator}. You submit on their site; VANTAGE sends nothing.</span>}
      </div>
      {!here ? (
        <Empty title="Waiting for your location">Work orders are listed around you. Allow location access, or pick a place on the City screen.</Empty>
      ) : orders.error && !list ? (
        <Empty title="Work orders unavailable" tone="error">
          {orders.error.message}
        </Empty>
      ) : !list ? (
        <Scanning label="Reading open reports" />
      ) : (
        <>
          <div className="reach-orders__sources">
            {list.sources.map((s) => (
              <span key={s.operator} className="reach-orders__source" title={s.error ?? "Answered"}>
                <LiveDot tone={s.error ? "alarm" : "mint"} live={!s.error} /> {s.operator}
                {s.error && <span className="reach-orders__problem"> · {s.error}</span>}
              </span>
            ))}
            <span className="reach-orders__source">within {radiusKm} km</span>
          </div>
          {rows.length === 0 ? (
            <Empty title="No open work orders within reach">
              None of the services VANTAGE reads has an open report within {radiusKm} km. It reads SeeClickFix (many US cities), FixMyStreet (UK, Sweden, Zürich), Fix My Street Brussels, Cologne's Sags uns and Boston 311. No open feed was found for Italian cities, so for Rome use the city's own reporting page.
            </Empty>
          ) : (
            <ul className="reach-orders">
              {rows.map(({ item: o, distanceM: d }) => (
                <li key={o.id}>
                  <button type="button" className="reach-orders__row" onClick={() => profile.open({ kind: "workorder", id: o.id, data: o })}>
                    <span className="reach-orders__cat">{o.category}</span>
                    <span className="reach-orders__desc">{o.description ?? o.authority ?? o.operator}</span>
                    <span className="reach-orders__meta num">{fmt.distance(d, units)}</span>
                    <span className="reach-orders__meta num">{fmt.ago(o.createdAt)}</span>
                    <span className="reach-orders__tag">
                      <Tag tone={o.status === "acknowledged" ? "mint" : undefined}>{o.status === "acknowledged" ? "Acknowledged" : "Open"}</Tag>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}

export function NotesSection({ here, notes }: { here: LatLon | null; notes: Polled<NoteList> }): ReactElement {
  const units = useSettings((s) => s.units);
  const list = notes.data;
  const rows = list && here ? nearest(list.notes, here, 8) : [];

  return (
    <Panel title="Notes on the world map">
      <div className="reach-actions">
        <Button size="sm" variant="primary" icon={<PenLine size={13} />} onClick={() => leaveNote(here)}>
          Leave a note here
        </Button>
        <Button size="sm" icon={<Camera size={13} />} onClick={() => leaveNote(here, CAMERA_NOTE)} title="Report a surveillance camera that is not on the map yet">
          Camera template
        </Button>
        <Button size="sm" icon={<MapIcon size={13} />} onClick={() => showLayer("reach.notes")}>
          On the map
        </Button>
      </div>
      {!here ? (
        <Empty title="Waiting for your location">Notes are listed around you. You can still leave a note anywhere: press the button and enter a position.</Empty>
      ) : notes.error && !list ? (
        <Empty title="Map notes unavailable" tone="error">
          {notes.error.message}
        </Empty>
      ) : !list ? (
        <Scanning label="Reading notes" />
      ) : rows.length === 0 ? (
        <Empty title="No notes near you">OpenStreetMap has no open notes within about 10 km, and none closed in the last week. A missing camera, shop or path is a good first note.</Empty>
      ) : (
        <ul className="reach-orders">
          {rows.map(({ item: n }) => (
            <li key={n.id}>
              <button type="button" className="reach-orders__row" onClick={() => profile.open({ kind: "mapnote", id: String(n.id), data: n })}>
                <span className="reach-orders__cat">Note {n.id}</span>
                <span className="reach-orders__desc">{n.comments[0]?.text ?? ""}</span>
                <span className="reach-orders__meta num">{fmt.distance(distanceM(here, n), units)}</span>
                <span className="reach-orders__meta num">{fmt.ago(n.createdAt)}</span>
                <span className="reach-orders__tag">
                  <Tag tone={n.status === "open" ? "sodium" : undefined}>{n.status === "open" ? "Open" : "Closed"}</Tag>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
