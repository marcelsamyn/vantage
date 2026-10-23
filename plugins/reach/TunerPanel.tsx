import { ExternalLink, X } from "lucide-react";
import type { ReactElement } from "react";
import { usePoll } from "../../app/core/hooks";
import { Button, Empty, IconButton, Panel, Scanning, Tag } from "../../app/ui";
import { fetchEmbeddable, useReceivers } from "./client";
import { isFull, seatsText, tuneUrl, type Beacon, type Receiver } from "./types";

/**
 * A receiver's own web page in a large panel. The panel appears only after a click on "Tune in", and the page asks for
 * its own click before it plays sound. A receiver that forbids framing gets a button that opens it in a new tab instead.
 */
export function TunerPanel({ receiver, beacon, onClose }: { receiver: Receiver; beacon: Beacon | null; onClose: () => void }): ReactElement {
  const live = useReceivers().data?.receivers.find((r) => r.id === receiver.id) ?? receiver;
  const check = usePoll((signal) => fetchEmbeddable(receiver.id, signal), null, [receiver.id]);
  const url = tuneUrl(live, beacon ? { kHz: beacon.kHz, mode: beacon.mode } : undefined);
  const full = isFull(live);

  return (
    <Panel
      title={beacon ? `Tuned to ${beacon.label}` : "Tuned receiver"}
      active
      actions={
        <span className="reach-tuner__actions">
          <a className="v-btn v-btn--sm v-btn--ghost" href={url} target="_blank" rel="noreferrer noopener">
            <ExternalLink size={13} /> New tab
          </a>
          <IconButton label="Close the receiver panel" onClick={onClose}>
            <X size={14} />
          </IconButton>
        </span>
      }
    >
      <div className="reach-tuner__head">
        <div className="reach-tuner__name">{live.name}</div>
        <Tag tone={full ? "alarm" : "mint"}>{seatsText(live)}</Tag>
      </div>
      {check.data?.embeddable ? (
        <>
          <iframe
            className="reach-tuner__frame"
            src={url}
            title={`Web interface of ${live.name}`}
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            allow="autoplay"
            referrerPolicy="no-referrer"
          />
          <p className="reach-tuner__note">
            Click inside the receiver to start sound.{beacon ? ` It was asked to tune ${beacon.label}; if the dial shows something else, type ${beacon.kHz} into its frequency box.` : ""} The panel belongs to the receiver's owner, not to VANTAGE.
          </p>
        </>
      ) : check.error ? (
        <Empty title="Could not check this receiver" tone="error" action={<Button onClick={check.refresh}>Check again</Button>}>
          {check.error.message} You can still open the receiver in its own tab.
        </Empty>
      ) : check.data ? (
        <Empty
          title="This receiver cannot be shown inside VANTAGE"
          action={
            <a className="v-btn v-btn--primary" href={url} target="_blank" rel="noreferrer noopener">
              <ExternalLink size={14} /> Open it in a new tab
            </a>
          }
        >
          {check.data.reason} Its own page works fine in a tab of its own.
        </Empty>
      ) : (
        <Scanning label="Checking whether the receiver allows framing" />
      )}
    </Panel>
  );
}
