import type { ReactElement } from "react";
import { go } from "../../app/core/nav";
import { useSettings } from "../../app/core/settings";
import { Empty, Scanning } from "../../app/ui";
import { complexName, useDsn } from "./client";
import { farthestLink, linkClause, signalLeftSentence } from "./links";
import "./deepspace.css";

/** Briefing tile: the farthest voice on the network, in one sentence, with a signal running in from the edge. */
export default function DeepspaceTile(): ReactElement {
  const dsn = useDsn();
  const units = useSettings((s) => s.units);

  if (!dsn.data) {
    return dsn.error ? (
      <Empty title="No reading from the Deep Space Network" tone="error">
        {dsn.error.message}
      </Empty>
    ) : (
      <Scanning label="Listening to the Deep Space Network" />
    );
  }

  const link = farthestLink(dsn.data.links);
  if (!link) {
    return <Empty title="No dish has a distant signal">The network is quiet at this moment, or every spacecraft on air is missing a distance. This tile fills as soon as a pass begins.</Empty>;
  }

  const name = complexName(dsn.data, link.complexId);
  const clause = linkClause(link, name, units);
  const [head, ...tail] = clause.split(link.spacecraft.name);
  const left = signalLeftSentence(link);

  return (
    <button type="button" className="deepspace-tile" onClick={() => go("deepspace")} aria-label="Open Deep space">
      <p className="deepspace-tile__text">
        Right now {head}
        <strong className="deepspace-tile__craft">{link.spacecraft.name}</strong>
        {tail.join(link.spacecraft.name)} {left}
      </p>
      <div className="deepspace-tile__path" aria-hidden>
        <div className="deepspace-tile__beam" />
        <div className="deepspace-tile__ends v-eyebrow">
          <span>{name}</span>
          <span>{link.spacecraft.name}</span>
        </div>
      </div>
    </button>
  );
}
