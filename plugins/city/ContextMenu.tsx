import { Bike, Car, Footprints, MapPin, ScanSearch } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, type ReactElement, type ReactNode } from "react";
import { feed } from "../../app/core/feed";
import { fmt } from "../../app/core/format";
import { useLocation } from "../../app/core/location";
import { profile } from "../../app/core/profile";
import { sfx } from "../../app/core/sound";
import { routeTo } from "./client";

export interface MenuAt {
  x: number;
  y: number;
  lat: number;
  lon: number;
}

/** Right-click menu on the map. */
export function ContextMenu({ at, onClose }: { at: MenuAt; onClose: () => void }): ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const item = (icon: ReactNode, label: string, action: () => void): ReactElement => (
    <button
      type="button"
      className="city-menu__item"
      role="menuitem"
      onClick={() => {
        sfx.click();
        onClose();
        action();
      }}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <motion.div
      className="city-menu"
      role="menu"
      style={{ left: at.x, top: at.y }}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", duration: 0.2, bounce: 0 }}
    >
      <div className="city-menu__head num">{fmt.coord(at.lat, at.lon)}</div>
      {item(<ScanSearch size={14} />, "What's here?", () =>
        profile.open({ kind: "place", id: `${at.lat.toFixed(5)},${at.lon.toFixed(5)}`, data: { lat: at.lat, lon: at.lon, name: "Dropped pin", context: "", area: "", kind: "point", countryCode: null } }),
      )}
      {item(<Footprints size={14} />, "Walk here", () => void routeTo(at, "foot"))}
      {item(<Bike size={14} />, "Cycle here", () => void routeTo(at, "bike"))}
      {item(<Car size={14} />, "Drive here", () => void routeTo(at, "car"))}
      {item(<MapPin size={14} />, "Pin as my location", () => {
        useLocation.getState().setManual(at.lat, at.lon, fmt.coord(at.lat, at.lon));
        feed({ level: "good", source: "city", title: "Location pinned", detail: "Use “Locate me again” in the command palette to return to your real position." });
      })}
    </motion.div>
  );
}
