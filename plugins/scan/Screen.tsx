import { useEffect, useState, type ReactElement } from "react";
import { useIntent } from "../../app/core/nav";
import { Page, Panel, Segmented } from "../../app/ui";
import { QrLayer, QrPanel } from "./Qr";
import { QrMaker } from "./QrMaker";
import { RecBadge, SentryPanel, ZoneLayer } from "./Sentry";
import { SourceBar } from "./SourceBar";
import { Stage } from "./Stage";
import { VisionLayer, VisionPanel } from "./Vision";
import { Wall } from "./Wall";
import { useQr } from "./qr-scanner";
import { useSentryEngine } from "./sentry-engine";
import { useSource } from "./source";
import { useSentry } from "./store";
import type { ScanMode } from "./types";
import { useVision } from "./vision-engine";
import "./scan.css";

const MODES = [
  { value: "vision", label: "Vision" },
  { value: "qr", label: "QR" },
  { value: "sentry", label: "Sentry" },
  { value: "wall", label: "Wall" },
] as const satisfies readonly { value: ScanMode; label: string }[];

const isMode = (v: string): v is ScanMode => MODES.some((m) => m.value === v);

export default function ScanScreen(): ReactElement {
  const source = useSource();
  const [mode, setMode] = useState<ScanMode>("vision");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const picture = source.status === "live" && source.info !== null;
  const canArm = picture && source.info?.kind !== "image";
  const vision = useVision(source.getFrame, mode === "vision" && picture);
  const scanner = useQr(source.getFrame, mode === "qr" && picture);
  useSentryEngine(source.getFrame, source.info?.label ?? "Camera");

  useIntent("scan", (intent) => {
    if (isMode(intent.action)) setMode(intent.action);
  });

  // Sentry only watches a picture that exists. It also stops with the screen.
  useEffect(() => {
    if (!canArm) useSentry.getState().disarm();
  }, [canArm]);
  useEffect(() => () => useSentry.getState().disarm(), []);

  useEffect(() => setSelectedId(null), [source.info?.label, mode]);

  const wall = mode === "wall";
  const arming = !canArm ? (source.info?.kind === "image" ? "A still image never changes. Use your camera or a video file to arm the sentry." : "Choose your camera or a video file first. The sentry watches the picture above.") : null;

  return (
    <Page
      eyebrow="Scan"
      title="Scan"
      lede="Point your camera at the world. VANTAGE names what it sees, reads QR codes and watches for movement."
      actions={<Segmented label="Scan mode" value={mode} options={MODES} onChange={setMode} />}
    >
      <div className={`scan-layout${wall ? " scan-layout--wall" : ""}`}>
        <div className="scan-main">
          <Panel className="scan-source-panel">
            <SourceBar source={source} />
          </Panel>
          {wall && <Wall filePicture={source.info !== null && source.info.kind !== "camera"} />}
          <Panel flush solid className={wall ? "scan-stage-panel scan-stage-panel--hidden" : "scan-stage-panel"}>
            <Stage source={source} hidden={wall}>
              {mode === "vision" && <VisionLayer vision={vision} getFrame={source.getFrame} hasPicture={picture} selectedId={selectedId} onSelect={setSelectedId} />}
              {mode === "qr" && <QrLayer scanner={scanner} getFrame={source.getFrame} hasPicture={picture} />}
              {mode === "sentry" && picture && source.info?.kind !== "image" && <ZoneLayer />}
              <RecBadge />
            </Stage>
          </Panel>
          {mode === "qr" && <QrMaker />}
        </div>
        {!wall && (
          <aside className="scan-side" aria-label={`${mode} results`}>
            {mode === "vision" && <VisionPanel vision={vision} selectedId={selectedId} onSelect={setSelectedId} getFrame={source.getFrame} hasPicture={picture} />}
            {mode === "qr" && <QrPanel scanner={scanner} hasPicture={picture} />}
            {mode === "sentry" && <SentryPanel canArm={canArm} reason={arming} />}
          </aside>
        )}
      </div>
    </Page>
  );
}
