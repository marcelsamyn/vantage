import type { ReactElement } from "react";
import type { ProfilerSectionProps } from "../../app/core/plugin";
import "./dossier.css";
import { hotspotById } from "./things-wifi";
import { languageMix, languageName } from "./wifi-format";

/**
 * The language mix of one of Rome's Wi-Fi hotspots, on every profile of a thing the city's hotspot records
 * reported. Nothing to say about any other thing on the map, so nothing is drawn.
 */
export default function WifiMix({ entity }: ProfilerSectionProps<"thing">): ReactElement | null {
  const member = entity.data.members.find((m) => m.source === "dossier.wifi");
  const found = member ? hotspotById(member.thing.id) : null;
  if (!found || found.hotspot.languages.length === 0) return null;
  const { languages } = found.hotspot;
  return (
    <section>
      <h4 className="v-eyebrow">Who connects here</h4>
      <div className="dossier-mix" role="img" aria-label={`Interface language: ${languageMix(languages)}`}>
        {languages.map((l) => (
          <span key={l.code} className="dossier-mix__part" style={{ flexGrow: l.share }} title={`${languageName(l.code)} ${Math.round(l.share * 100)} %`} />
        ))}
      </div>
    </section>
  );
}
