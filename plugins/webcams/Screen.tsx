import { useEffect, useState, type ReactElement } from "react";
import { errorMessage } from "../../app/core/api";
import { feed } from "../../app/core/feed";
import { useLocation } from "../../app/core/location";
import { useIntent } from "../../app/core/nav";
import { Page, Segmented } from "../../app/ui";
import { fetchRandomCity } from "./client";
import { OrbitTab } from "./Orbit";
import { RemoteTab } from "./Remote";
import { NearTab, type Origin } from "./Wall";
import "./webcams.css";

type Tab = "near" | "remote" | "orbit";

const TABS: readonly { value: Tab; label: string }[] = [
  { value: "near", label: "Near" },
  { value: "remote", label: "Remote" },
  { value: "orbit", label: "Orbit" },
];

/** Cameras: open cameras around you, in places nobody goes, and in orbit. */
export default function CamerasScreen(): ReactElement {
  const [tab, setTab] = useState<Tab>("near");
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [randomNonce, setRandomNonce] = useState(0);
  const here = useLocation((s) => s.here);
  const status = useLocation((s) => s.status);

  useEffect(() => {
    if (!here && status === "idle") void useLocation.getState().locate();
  }, [here, status]);

  useIntent("webcams", ({ action }) => {
    if (action === "remote" || action === "orbit") setTab(action);
    else if (action === "near") {
      setTab("near");
      setOrigin(null);
    } else if (action === "random") {
      setTab("near");
      fetchRandomCity()
        .then((city) => {
          setOrigin({ lat: city.lat, lon: city.lon, label: city.name });
          setRandomNonce((n) => n + 1);
        })
        .catch((err: unknown) => feed({ level: "alert", source: "webcams", title: "No camera to jump to", detail: errorMessage(err) }, { toast: true }));
    }
  });

  return (
    <Page
      eyebrow="Cameras · worldwide"
      title="Cameras"
      lede="Live camera pictures from road operators, public webcams, volcano observatories, ocean buoys and space."
      actions={<Segmented label="Where to look" value={tab} onChange={setTab} options={TABS} />}
    >
      {tab === "near" && <NearTab origin={origin} onOrigin={setOrigin} randomNonce={randomNonce} />}
      {tab === "remote" && <RemoteTab />}
      {tab === "orbit" && <OrbitTab />}
    </Page>
  );
}
