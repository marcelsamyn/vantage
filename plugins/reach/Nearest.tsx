import { motion } from "motion/react";
import type { ReactElement, ReactNode } from "react";
import { fmt } from "../../app/core/format";
import { profile } from "../../app/core/profile";
import { useSettings } from "../../app/core/settings";
import { Empty, Panel, Scanning } from "../../app/ui";
import { compassPoint, bearingDeg, type LatLon } from "../../shared/geo";
import { nearest, receiverIsFree, type Ranked } from "./client";
import { seatsText, type GroundStation, type MapNote, type Receiver, type WorkOrder } from "./types";

interface Column<T> {
  title: string;
  tone: "sodium" | "mint" | "bone" | "fog";
  items: Ranked<T>[] | null;
  error: string | null;
  empty: string;
  row: (item: T) => { name: string; sub: string; open: () => void };
}

function NearColumn<T extends LatLon>({ title, tone, items, error, empty, row, here, index }: Column<T> & { here: LatLon; index: number }): ReactElement {
  const units = useSettings((s) => s.units);
  let body: ReactNode;
  if (items) {
    body =
      items.length === 0 ? (
        <p className="reach-near__none">{empty}</p>
      ) : (
        items.map(({ item, distanceM }) => {
          const r = row(item);
          return (
            <button key={r.name + distanceM} type="button" className="reach-near__row" onClick={r.open}>
              <span className="reach-near__name">{r.name}</span>
              <span className="reach-near__sub">{r.sub}</span>
              <span className="reach-near__dist num">
                {fmt.distance(distanceM, units)} <span className="reach-near__dir">{compassPoint(bearingDeg(here, item))}</span>
              </span>
            </button>
          );
        })
      );
  } else if (error) {
    body = (
      <Empty title="Not available" tone="error">
        {error}
      </Empty>
    );
  } else {
    body = <Scanning label="Looking" />;
  }
  return (
    <motion.div className={`reach-near__col reach-near__col--${tone}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * index, type: "spring", duration: 0.4, bounce: 0 }}>
      <div className="v-eyebrow reach-near__title">{title}</div>
      {body}
    </motion.div>
  );
}

export interface NearestProps {
  here: LatLon | null;
  receivers: readonly Receiver[] | undefined;
  stations: readonly GroundStation[] | undefined;
  orders: readonly WorkOrder[] | undefined;
  notes: readonly MapNote[] | undefined;
  errors: { receivers: string | null; stations: string | null; orders: string | null; notes: string | null };
}

/** The three closest of each kind, with distance and direction, each one a door to its profile. */
export function Nearest({ here, receivers, stations, orders, notes, errors }: NearestProps): ReactElement {
  if (!here) {
    return (
      <Panel title="Nearest to you">
        <Empty title="Waiting for your location">VANTAGE needs a position to measure from. Allow location access in the browser, or search for a place on the City screen.</Empty>
      </Panel>
    );
  }
  return (
    <Panel title="Nearest to you">
      <div className="reach-near">
        <NearColumn
          here={here}
          index={0}
          title="Radios with a free slot"
          tone="sodium"
          items={receivers ? nearest(receivers.filter(receiverIsFree), here, 3) : null}
          error={errors.receivers}
          empty="Every receiver on the list is full right now."
          row={(r) => ({ name: r.name, sub: seatsText(r), open: () => profile.open({ kind: "receiver", id: r.id, data: r }) })}
        />
        <NearColumn
          here={here}
          index={1}
          title="Ground stations"
          tone="mint"
          items={stations ? nearest(stations.filter((s) => s.status === "online"), here, 3) : null}
          error={errors.stations}
          empty="No station is online."
          row={(s) => ({ name: s.name, sub: s.observing ? `Recording ${s.observing.satellite}` : "Online", open: () => profile.open({ kind: "groundstation", id: String(s.id), data: s }) })}
        />
        <NearColumn
          here={here}
          index={2}
          title="Open work orders"
          tone="bone"
          items={orders ? nearest(orders, here, 3) : null}
          error={errors.orders}
          empty="No open reports within 8 km from the services VANTAGE reads."
          row={(o) => ({ name: o.category, sub: `${o.operator}, ${fmt.ago(o.createdAt)}`, open: () => profile.open({ kind: "workorder", id: o.id, data: o }) })}
        />
        <NearColumn
          here={here}
          index={3}
          title="Open map notes"
          tone="fog"
          items={notes ? nearest(notes.filter((n) => n.status === "open"), here, 3) : null}
          error={errors.notes}
          empty="No open notes within about 10 km."
          row={(n) => ({ name: `Note ${n.id}`, sub: n.comments[0]?.text.slice(0, 48) ?? "", open: () => profile.open({ kind: "mapnote", id: String(n.id), data: n }) })}
        />
      </div>
    </Panel>
  );
}
