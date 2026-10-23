import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useLocation } from "../../app/core/location";
import { go } from "../../app/core/nav";
import { profile } from "../../app/core/profile";
import { useSettings } from "../../app/core/settings";
import { Empty, Scanning, Stat } from "../../app/ui";
import { nearest, receiverIsFree, useOrders, useReceivers, useStations } from "./client";
import "./reach.css";

/** Briefing tile: how much of the outside world you can operate right now, and the nearest open repair request. */
export default function ReachTile(): ReactElement {
  const units = useSettings((s) => s.units);
  const here = useLocation((s) => s.here);
  const receivers = useReceivers();
  const stations = useStations();
  const orders = useOrders(here, 8);

  const radios = receivers.data?.receivers.filter(receiverIsFree).length;
  const online = stations.data?.stations.filter((s) => s.status === "online").length;
  const order = here && orders.data ? nearest(orders.data.orders, here, 1)[0] : undefined;

  if (radios === undefined && online === undefined) {
    const error = receivers.error ?? stations.error;
    return error ? (
      <Empty title="Nothing in reach yet" tone="error">
        {error.message}
      </Empty>
    ) : (
      <Scanning label="Finding what you can operate" />
    );
  }

  return (
    <div className="reach-tile">
      <div className="reach-tile__stats">
        <Stat label="Radios you can tune" value={radios === undefined ? "–" : fmt.int(radios)} tone="sodium" size="sm" />
        <Stat label="Ground stations online" value={online === undefined ? "–" : fmt.int(online)} tone="mint" size="sm" />
      </div>
      <button type="button" className="reach-tile__order" onClick={() => (order ? profile.open({ kind: "workorder", id: order.item.id, data: order.item }) : go("reach", { action: "orders" }))}>
        <span className="v-eyebrow">Nearest open work order</span>
        {order ? (
          <>
            <span className="reach-tile__cat">{order.item.category}</span>
            <span className="v-stat__hint">
              {fmt.distance(order.distanceM, units)} away · reported {fmt.ago(order.item.createdAt)}
            </span>
          </>
        ) : (
          <span className="v-stat__hint">{!here ? "Waiting for your location" : orders.error && !orders.data ? "Reports unavailable right now" : orders.data ? "None within 8 km from the services VANTAGE reads" : "Reading open reports"}</span>
        )}
      </button>
    </div>
  );
}
