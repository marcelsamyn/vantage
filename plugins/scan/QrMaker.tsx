import { Download } from "lucide-react";
import { toCanvas } from "qrcode";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Button, Input, Panel, Segmented, Toggle } from "../../app/ui";
import { readInk } from "./hud";
import { buildWifi } from "./wifi";

type Kind = "text" | "url" | "wifi";
type Security = "WPA" | "WEP" | "nopass";

const KINDS = [
  { value: "text", label: "Text" },
  { value: "url", label: "Link" },
  { value: "wifi", label: "Wi-Fi" },
] as const;

const SECURITY = [
  { value: "WPA", label: "WPA" },
  { value: "WEP", label: "WEP" },
  { value: "nopass", label: "Open" },
] as const;

const SIZE = 512;

/** Render a code to a canvas in VANTAGE's own ink: near-black modules on bone, so every scanner can read it. */
export function QrMaker(): ReactElement {
  const [kind, setKind] = useState<Kind>("url");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [security, setSecurity] = useState<Security>("WPA");
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const payload = useMemo((): string => {
    if (kind === "text") return text;
    if (kind === "url") return url.trim();
    return ssid ? buildWifi({ ssid, security, password, hidden }) : "";
  }, [kind, text, url, ssid, security, password, hidden]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !payload) return;
    let alive = true;
    const ink = readInk();
    toCanvas(canvas, payload, { width: SIZE, margin: 2, errorCorrectionLevel: "M", color: { dark: ink.void, light: ink.bone } }).then(
      () => {
        // The library pins the canvas to its pixel size. CSS sizes it instead so it fits any column.
        canvas.style.removeProperty("width");
        canvas.style.removeProperty("height");
        if (alive) setError(null);
      },
      (err: unknown) => alive && setError(err instanceof Error ? err.message : "This content cannot be encoded."),
    );
    return () => {
      alive = false;
    };
  }, [payload]);

  const download = (): void => {
    canvasRef.current?.toBlob((blob) => {
      if (!blob) return;
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `vantage-qr-${kind}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    }, "image/png");
  };

  const ready = payload.length > 0 && !error;

  return (
    <Panel title="Make a QR code" actions={<Segmented label="Content type" value={kind} options={KINDS} onChange={setKind} />}>
      <div className="scan-maker">
        <div className="scan-maker__form">
          {kind === "text" && <textarea className="v-textarea" aria-label="Text to encode" placeholder="Any text, up to a few hundred characters" value={text} onChange={(e) => setText(e.target.value)} />}
          {kind === "url" && <Input prompt="›" aria-label="Link to encode" placeholder="https://example.com" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} />}
          {kind === "wifi" && (
            <>
              <Input prompt="SSID" aria-label="Network name" placeholder="Network name" value={ssid} onChange={(e) => setSsid(e.target.value)} />
              <Segmented label="Security" value={security} options={SECURITY} onChange={setSecurity} />
              {security !== "nopass" && <Input prompt="PASS" aria-label="Password" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />}
              <Toggle checked={hidden} onChange={setHidden} label="Hidden network" />
            </>
          )}
          <p className="scan-note">Made on this Mac. Nothing you type is sent anywhere. Anyone who scans a Wi-Fi code can read its password.</p>
          {error && <p className="scan-note scan-note--error">{error} Shorten the content and try again.</p>}
          <div className="scan-actions">
            <Button variant="primary" icon={<Download size={14} />} disabled={!ready} onClick={download}>
              Download PNG
            </Button>
          </div>
        </div>
        <div className="scan-maker__preview">
          <div className="scan-code">
            <canvas ref={canvasRef} className="scan-code__canvas" hidden={!payload} aria-label="Generated QR code" />
            {!payload && <span className="scan-code__empty">Your code appears here</span>}
          </div>
        </div>
      </div>
    </Panel>
  );
}
