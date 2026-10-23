import { Bike, Footprints } from "lucide-react";
import { useMemo, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useLocation } from "../../app/core/location";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings } from "../../app/core/settings";
import { thingActions, thingTypes, type FusedThing, type ThingState, type ThingTone } from "../../app/core/things";
import { ActionButton, Button, ProfilerCard, Readout, type MaybeRow, type Tone } from "../../app/ui";
import { bearingDeg, compassPoint, distanceM } from "../../shared/geo";
import { routeTo } from "./client";

/**
 * One thing on the map, as every source that found it sees it. Each source keeps its own words: one block per
 * source, in the order the sources were asked, with the actions they offer under them.
 */

const CARD_TONE: Record<ThingTone, Tone> = { ice: "ice", mint: "mint", sodium: "sodium", alarm: "alarm", bone: "ice", fog: "ice" };
const STATE_WORD: Record<ThingState, string | null> = { ok: null, low: "Running low", out: "Out of service", unknown: null };

/** "OpenStreetMap and Rome nasoni agree", "Rome nasoni only". */
function agreement(thing: FusedThing): string {
  const titles = thing.members.map((m) => m.title);
  if (titles.length === 1) return titles[0] ?? "";
  return `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)} agree`;
}

export default function ThingProfile({ entity, onClose }: ProfilerProps<"thing">): ReactElement {
  const thing = entity.data;
  const type = useMemo(() => thingTypes().find((t) => t.id === thing.type), [thing.type]);
  const units = useSettings((s) => s.units);
  const here = useLocation((s) => s.here);
  const away = here ? distanceM(here, thing.at) : null;
  const actions = thingActions(thing);
  const credits = [...new Set(thing.members.flatMap((m) => (m.attribution ? [m.attribution] : [])))];
  const alone = thing.members.length === 1 ? thing.members[0] : null;

  return (
    <ProfilerCard
      band={type?.title ?? "Thing"}
      name={thing.name}
      kicker={[thing.detail, STATE_WORD[thing.state]].filter(Boolean).join(" · ") || agreement(thing)}
      tone={CARD_TONE[type?.tone ?? "ice"]}
      media={thing.image}
      onClose={onClose}
      rows={[
        ...(alone?.thing.rows ?? []),
        ["Position", fmt.coord(thing.at.lat, thing.at.lon)],
        away !== null && here && ["From you", `${fmt.distance(away, units)} ${compassPoint(bearingDeg(here, thing.at))}`],
      ]}
      actions={
        <>
          <Button size="sm" icon={<Footprints size={13} />} onClick={() => void routeTo({ ...thing.at, name: thing.name }, "foot")}>
            Walk there
          </Button>
          <Button size="sm" variant="ghost" icon={<Bike size={13} />} onClick={() => void routeTo({ ...thing.at, name: thing.name }, "bike")}>
            Cycle
          </Button>
          {actions.map((action) => (
            <ActionButton key={action.label} action={action} quiet />
          ))}
        </>
      }
      fact={thing.fact ?? undefined}
      source={credits.join(" · ")}
    >
      {!alone && (
        <div className="city-thing__sources">
          {thing.members.map((m) => {
            // What this source adds: its own facts, the name it uses when another source calls it something else,
            // and where it puts the thing when that is not where the others do.
            const rows: MaybeRow[] = [...(m.thing.rows ?? [])];
            const called = m.thing.name ?? m.thing.label ?? null;
            if (called !== null && called !== thing.name) rows.push(["Known as", called]);
            if (distanceM(m.thing.at, thing.at) >= 1) rows.push(["Puts it at", `${fmt.coord(m.thing.at.lat, m.thing.at.lon)} · ${fmt.distance(distanceM(m.thing.at, thing.at), units)} off`]);
            return (
              <section key={m.source} className="city-thing__source">
                <h4 className="v-eyebrow">{m.title}</h4>
                {rows.length > 0 ? <Readout rows={rows} /> : <p className="city-thing__quiet">Has it on file, with nothing more to say.</p>}
              </section>
            );
          })}
        </div>
      )}
    </ProfilerCard>
  );
}
