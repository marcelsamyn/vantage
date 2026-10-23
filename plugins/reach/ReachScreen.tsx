import { ClipboardList, PenLine, Radio, Satellite } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { fmt } from "../../app/core/format";
import { usePoll, useScreenActive } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { useIntent } from "../../app/core/nav";
import { profile } from "../../app/core/profile";
import { Page, Panel } from "../../app/ui";
import { distanceM } from "../../shared/geo";
import { NotesSection, OrdersSection } from "./CivicSections";
import { fetchLand, nearest, receiverIsFree, useNotesAround, useOrders, useReceivers, useStations } from "./client";
import { HearSection } from "./HearSection";
import { Nearest } from "./Nearest";
import { NoteDialog } from "./NoteDialog";
import { ReachWorld } from "./ReachWorld";
import { leaveNote, useReach } from "./store";
import { TunerPanel } from "./TunerPanel";
import "./reach.css";

/** A receiver this far away is "somewhere else" for the Tune a radio command. */
const FAR_M = 3_000_000;
const ORDERS_KM = 8;

export default function ReachScreen(): ReactElement {
  const here = useLocation((s) => s.here);
  const active = useScreenActive();
  const receivers = useReceivers();
  const stations = useStations();
  const orders = useOrders(here, ORDERS_KM);
  const notes = useNotesAround(here);
  const land = usePoll((signal) => fetchLand(signal), null, []);
  const tuner = useReach((s) => s.tuner);
  const closeTuner = useReach((s) => s.closeTuner);
  const [flyTo, setFlyTo] = useState<{ at: { lat: number; lon: number }; scale: number; nonce: number } | null>(null);
  const tunerRef = useRef<HTMLDivElement>(null);
  const ordersRef = useRef<HTMLDivElement>(null);

  const rx = receivers.data?.receivers;
  const gs = stations.data?.stations;
  const freeRx = useMemo(() => rx?.filter(receiverIsFree).length ?? 0, [rx]);
  const recording = gs?.filter((s) => s.observing !== null).length ?? 0;

  useEffect(() => {
    if (tuner) tunerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [tuner]);

  const tuneElsewhere = (): void => {
    const free = (rx ?? []).filter(receiverIsFree);
    const far = here ? free.filter((r) => distanceM(here, r) >= FAR_M) : free;
    const pick = far[Math.floor(Math.random() * far.length)];
    if (pick) profile.open({ kind: "receiver", id: pick.id, data: pick });
  };
  const listenThrough = (): void => {
    const online = (gs ?? []).filter((s) => s.status === "online" && s.observations > 0);
    const pick = here ? nearest(online, here, 1)[0]?.item : online[0];
    if (pick) profile.open({ kind: "groundstation", id: String(pick.id), data: pick });
  };
  const showOrders = (): void => {
    if (here) setFlyTo({ at: here, scale: 60, nonce: Date.now() });
    ordersRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // A palette command can arrive before the lists have loaded, so the action waits for what it needs.
  const [pending, setPending] = useState<string | null>(null);
  useIntent("reach", ({ action }) => setPending(action));
  useEffect(() => {
    if (pending === null) return;
    const ready = pending === "tune" ? rx !== undefined : pending === "listen" ? gs !== undefined : pending === "orders" ? here !== null : true;
    if (!ready) return;
    if (pending === "tune") tuneElsewhere();
    else if (pending === "listen") listenThrough();
    else if (pending === "orders") showOrders();
    else if (pending === "note") leaveNote(here);
    setPending(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, rx, gs, here]);

  const commands: { title: string; hint: string; icon: ReactNode; run: () => void; disabled: boolean; why: string }[] = [
    { title: "Tune a radio somewhere else", hint: "Pick a free receiver at least 3,000 km away and look at it before you connect.", icon: <Radio size={16} />, run: tuneElsewhere, disabled: !rx, why: "The receiver list is still loading" },
    { title: "Listen through a satellite ground station", hint: "Open the nearest online station and play a pass it recorded.", icon: <Satellite size={16} />, run: listenThrough, disabled: !gs, why: "The station list is still loading" },
    { title: "Show the city's open work orders", hint: `Zoom to the open reports within ${ORDERS_KM} km of you.`, icon: <ClipboardList size={16} />, run: showOrders, disabled: !here, why: "VANTAGE does not know where you are yet" },
    { title: "Leave a map note here", hint: "Write a public note on OpenStreetMap. You confirm the exact text first.", icon: <PenLine size={16} />, run: () => leaveNote(here), disabled: false, why: "" },
  ];

  const errors = {
    receivers: receivers.error && !rx ? receivers.error.message : null,
    stations: stations.error && !gs ? stations.error.message : null,
    orders: orders.error && !orders.data ? orders.error.message : null,
    notes: notes.error && !notes.data ? notes.error.message : null,
  };

  return (
    <Page eyebrow="Reach" title="Reach" lede="Things in the outside world you can use: radio receivers you can tune, satellite stations you can hear through, your city's repair list, and notes on the world map.">
      <div className="reach">
        <Panel title="Within reach right now" flush>
          <ReachWorld receivers={rx ?? []} stations={gs ?? []} orders={orders.data?.orders ?? []} here={here} land={land.data} active={active} flyTo={flyTo} />
          <div className="reach-hero__counts">
            <span className="reach-hero__count reach-hero__count--rx">
              <b className="num">{rx ? fmt.int(rx.length) : "–"}</b> radios{rx ? `, ${fmt.int(freeRx)} with a free slot` : ""}
            </span>
            <span className="reach-hero__count reach-hero__count--gs">
              <b className="num">{gs ? fmt.int(gs.length) : "–"}</b> ground stations{gs ? `, ${fmt.int(recording)} recording now` : ""}
            </span>
            {stations.data && stations.data.offline > 0 && <span className="reach-hero__count">{fmt.int(stations.data.offline)} more stations are offline and not shown</span>}
          </div>
          {(errors.receivers || errors.stations || stations.data?.liveError) && (
            <ul className="reach-hero__problems" role="status">
              {errors.receivers && <li>Radio list unavailable: {errors.receivers}</li>}
              {errors.stations && <li>Ground station list unavailable: {errors.stations}</li>}
              {stations.data?.liveError && <li>Which stations are recording is unknown: {stations.data.liveError}</li>}
            </ul>
          )}
        </Panel>

        <div className="reach-commands">
          {commands.map((c) => (
            <button key={c.title} type="button" className="reach-command" disabled={c.disabled} title={c.disabled ? c.why : undefined} onClick={c.run}>
              <span className="reach-command__icon">{c.icon}</span>
              <span className="reach-command__title">{c.title}</span>
              <span className="reach-command__hint">{c.hint}</span>
            </button>
          ))}
        </div>

        {tuner && (
          <div ref={tunerRef} className="reach-anchor">
            <TunerPanel key={tuner.receiver.id} receiver={tuner.receiver} beacon={tuner.beacon} onClose={closeTuner} />
          </div>
        )}

        <Nearest here={here} receivers={rx} stations={gs} orders={orders.data?.orders} notes={notes.data?.notes} errors={errors} />

        <HearSection receivers={rx} here={here} error={errors.receivers} />

        <div ref={ordersRef} className="reach-anchor">
          <OrdersSection here={here} orders={orders} radiusKm={ORDERS_KM} />
        </div>

        <NotesSection here={here} notes={notes} />
      </div>
      <NoteDialog />
    </Page>
  );
}
