import { Command, Crosshair, Search, Volume2, VolumeX } from "lucide-react";
import { Suspense, type ReactElement } from "react";
import { fmt } from "../core/format";
import { useNow } from "../core/hooks";
import { useLocation } from "../core/location";
import { useNav } from "../core/nav";
import { contributions, lazyView, pluginById } from "../core/plugin";
import { useSettings } from "../core/settings";
import { Boundary, Kbd, Scramble } from "../ui";
import { usePalette } from "../core/palette";

export function StatusBar(): ReactElement {
  const active = useNav((s) => s.active);
  const title = pluginById(active)?.contributes.screen?.title ?? "";
  const items = contributions("status").sort((a, b) => (a.item.order ?? 0) - (b.item.order ?? 0));

  return (
    <header className="bar">
      <div className="bar__brand">
        <span className="bar__word">VANTAGE</span>
        <span className="bar__slash">/</span>
        <span className="bar__screen">
          <Scramble text={title} duration={380} />
        </span>
      </div>
      <div className="bar__spacer" />
      <div className="bar__items">
        {items.map(({ item }) => {
          const View = lazyView(item.view);
          return (
            <Boundary key={item.id} name={item.id} silent>
              <Suspense fallback={null}>
                <View />
              </Suspense>
            </Boundary>
          );
        })}
        <Here />
        <Clock />
        <SoundToggle />
        <button type="button" className="bar__item bar__hide-sm" onClick={() => usePalette.getState().setOpen(true)} aria-label="Open command palette">
          <Kbd>
            <Command size={10} />
          </Kbd>
          <Kbd>K</Kbd>
        </button>
        {/* Phones have no ⌘K, so the palette gets a button of its own. */}
        <button type="button" className="bar__item bar__show-sm" onClick={() => usePalette.getState().setOpen(true)} aria-label="Search screens and commands">
          <Search size={16} />
        </button>
      </div>
    </header>
  );
}

function Here(): ReactElement {
  const here = useLocation((s) => s.here);
  const status = useLocation((s) => s.status);
  const locate = useLocation((s) => s.locate);
  const label = here ? (here.label ?? fmt.coord(here.lat, here.lon)) : status === "locating" ? "Locating…" : "Location unknown";
  const precision = here?.source === "gps" ? `±${fmt.int(here.accuracyM ?? 0)} m` : here?.source === "ip" ? "approx." : here?.source === "manual" ? "pinned" : "";
  return (
    <button type="button" className="bar__item bar__hide-sm" onClick={() => void locate()} title={here ? `${fmt.coord(here.lat, here.lon)} · click to re-locate` : "Click to locate"}>
      <Crosshair size={13} className={here?.source === "gps" ? "ice" : undefined} />
      <span className="bar__place">{label}</span>
      {precision && <span className="faint">{precision}</span>}
    </button>
  );
}

function Clock(): ReactElement {
  const now = useNow(1000);
  return <span className="bar__item bar__clock bar__hide-sm">{fmt.clock(now, true)}</span>;
}

function SoundToggle(): ReactElement {
  const sound = useSettings((s) => s.sound);
  const set = useSettings((s) => s.set);
  return (
    <button type="button" className="bar__item" onClick={() => set({ sound: !sound })} aria-label={sound ? "Mute interface sounds" : "Unmute interface sounds"} title="Interface sounds (M)">
      {sound ? <Volume2 size={14} /> : <VolumeX size={14} />}
    </button>
  );
}
