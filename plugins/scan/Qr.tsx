import { motion } from "motion/react";
import { Check, Copy, Eye, EyeOff, X } from "lucide-react";
import { useMemo, useState, type ReactElement } from "react";
import { usePrefersReducedMotion } from "../../app/core/hooks";
import { Button, Empty, IconButton, Panel, Readout, Tag } from "../../app/ui";
import { readInk } from "./hud";
import { OverlayCanvas, type DrawFn } from "./Overlay";
import type { QrScanner } from "./qr-scanner";
import type { GetFrame } from "./types";
import { inspectUrl, VERDICT_TEXT, type UrlReport } from "./urlsafety";
import { describeSecurity, parseWifi } from "./wifi";

const LOCK_MS = 280;
const LOST_AFTER_MS = 700;
const FADE_MS = 400;

export function QrLayer({ scanner, getFrame, hasPicture }: { scanner: QrScanner; getFrame: GetFrame; hasPicture: boolean }): ReactElement {
  const ink = useMemo(readInk, []);
  const reduced = usePrefersReducedMotion();

  const draw: DrawFn = (ctx, w, h, now) => {
    const frame = getFrame();
    if (!frame) return;
    const lock = scanner.lockRef.current;
    const live = frame.kind !== "image";
    const stale = lock ? now - lock.lastSeen : Infinity;
    const vis = !lock ? 0 : !live || stale <= LOST_AFTER_MS ? 1 : Math.max(0, 1 - (stale - LOST_AFTER_MS) / FADE_MS);

    if (live && vis < 1) {
      // Viewfinder guide and a sweeping scan line while nothing is locked.
      const side = Math.min(w, h) * 0.56;
      const x = (w - side) / 2;
      const y = (h - side) / 2;
      const arm = side * 0.14;
      ctx.save();
      ctx.globalAlpha = 0.55 * (1 - vis);
      ctx.strokeStyle = ink.ice;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y + arm); ctx.lineTo(x, y); ctx.lineTo(x + arm, y);
      ctx.moveTo(x + side - arm, y); ctx.lineTo(x + side, y); ctx.lineTo(x + side, y + arm);
      ctx.moveTo(x + side, y + side - arm); ctx.lineTo(x + side, y + side); ctx.lineTo(x + side - arm, y + side);
      ctx.moveTo(x + arm, y + side); ctx.lineTo(x, y + side); ctx.lineTo(x, y + side - arm);
      ctx.stroke();
      if (!reduced) {
        const t = (now % 2400) / 2400;
        const sy = y + (t < 0.5 ? t * 2 : 2 - t * 2) * side;
        const grad = ctx.createLinearGradient(x, 0, x + side, 0);
        grad.addColorStop(0, "rgba(130, 228, 255, 0)");
        grad.addColorStop(0.5, ink.ice);
        grad.addColorStop(1, "rgba(130, 228, 255, 0)");
        ctx.fillStyle = grad;
        ctx.fillRect(x, sy - 1, side, 2);
      }
      ctx.restore();
    }
    if (!lock || vis <= 0) return;

    const sx = w / frame.width;
    const age = reduced ? LOCK_MS : now - lock.since;
    const p = Math.min(1, age / LOCK_MS);
    const ease = 1 - (1 - p) ** 3;
    const grow = 1.35 - 0.35 * ease;
    const cx = lock.corners.reduce((s, c) => s + c.x, 0) / 4;
    const cy = lock.corners.reduce((s, c) => s + c.y, 0) / 4;
    const pts = lock.corners.map((c) => ({ x: (cx + (c.x - cx) * grow) * sx, y: (cy + (c.y - cy) * grow) * sx }));

    ctx.save();
    ctx.globalAlpha = ease * vis;
    ctx.beginPath();
    pts.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
    ctx.closePath();
    ctx.fillStyle = "rgba(130, 228, 255, 0.14)";
    ctx.fill();
    ctx.strokeStyle = ink.ice;
    ctx.lineWidth = 2;
    ctx.stroke();
    // Heavier corners, like the profiler's lock.
    ctx.lineWidth = 4;
    pts.forEach((pt, i) => {
      const prev = pts[(i + 3) % 4];
      const next = pts[(i + 1) % 4];
      if (!prev || !next) return;
      ctx.beginPath();
      for (const q of [prev, next]) {
        const len = Math.hypot(q.x - pt.x, q.y - pt.y) || 1;
        const k = Math.min(18, len * 0.3) / len;
        ctx.moveTo(pt.x + (q.x - pt.x) * k, pt.y + (q.y - pt.y) * k);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
    });
    if (!reduced && age < 700) {
      const ring = age / 700;
      ctx.globalAlpha = (1 - ring) * 0.6 * vis;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx * sx, cy * sx, 20 + ring * 90, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  };

  return (
    <>
      <OverlayCanvas draw={draw} label="QR scanner view" active={hasPicture} />
      {scanner.empty && hasPicture && (
        <div className="scan-banner scan-banner--quiet">
          <span className="scan-banner__text">No QR code found in this picture</span>
        </div>
      )}
    </>
  );
}

function CopyButton({ text, label }: { text: string; label: string }): ReactElement {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      icon={done ? <Check size={12} /> : <Copy size={12} />}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        });
      }}
    >
      {done ? "Copied" : label}
    </Button>
  );
}

function LinkReadout({ report }: { report: UrlReport | null }): ReactElement | null {
  if (!report) return null;
  const verdict = VERDICT_TEXT[report.verdict];
  return (
    <div className="scan-safety">
      <div className="scan-safety__head">
        <Tag tone={verdict.tone}>{verdict.label}</Tag>
        <span className="scan-safety__scope">Checked on this Mac, nothing looked up</span>
      </div>
      <ul className="scan-safety__reasons">
        {report.reasons.map((reason) => (
          <li key={reason.text} className={`scan-safety__reason scan-safety__reason--${reason.tone}`}>
            {reason.text}
          </li>
        ))}
      </ul>
      <Readout rows={[report.host && ["Host", report.host], report.unicodeHost && ["Shows as", report.unicodeHost], ["Scheme", report.scheme]]} />
      {report.verdict === "ordinary" && <p className="scan-note">"Looks ordinary" means no warning signs in the text of the link. It does not vouch for the page behind it.</p>}
    </div>
  );
}

function WifiReadout({ text }: { text: string }): ReactElement | null {
  const net = useMemo(() => parseWifi(text), [text]);
  const [reveal, setReveal] = useState(false);
  if (!net) return null;
  const open = net.security === "nopass";
  return (
    <div className="scan-safety">
      <Readout
        rows={[
          ["Network", net.ssid || "(hidden name)"],
          ["Security", <span key="s" className={open ? "sodium" : undefined}>{describeSecurity(net.security)}</span>],
          net.hidden && ["Hidden", "Network does not broadcast its name"],
          !open && [
            "Password",
            <span key="p" className="scan-secret">
              <span className="num">{reveal ? net.password || "(empty)" : "•".repeat(Math.min(12, Math.max(6, net.password.length)))}</span>
              <IconButton label={reveal ? "Hide password" : "Show password"} on={reveal} onClick={() => setReveal((v) => !v)}>
                {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
              </IconButton>
            </span>,
          ],
        ]}
      />
      <p className="scan-note">VANTAGE only reads this code. It does not join the network for you. Join it from the Wi-Fi menu if you trust it.</p>
      {!open && (
        <div className="scan-actions">
          <CopyButton text={net.password} label="Copy password" />
        </div>
      )}
    </div>
  );
}

function kindLabel(text: string): string {
  if (parseWifi(text)) return "Wi-Fi network";
  if (inspectUrl(text)) return "Link";
  if (/^mailto:/i.test(text)) return "Email address";
  if (/^(tel|sms|smsto):/i.test(text)) return "Phone number";
  if (/^geo:/i.test(text)) return "Location";
  if (/^BEGIN:VCARD/i.test(text)) return "Contact card";
  return "Text";
}

export function QrPanel({ scanner, hasPicture }: { scanner: QrScanner; hasPicture: boolean }): ReactElement {
  const { result } = scanner;
  // A Wi-Fi code carries its password in plain text, so only the masked readout shows it.
  const secret = result ? parseWifi(result.text) !== null : false;
  const report = useMemo(() => (result ? inspectUrl(result.text) : null), [result]);
  return (
    <Panel
      title="QR code"
      active={Boolean(result)}
      actions={
        <>
          {scanner.decoder && <Tag>{scanner.decoder}</Tag>}
          {result && (
            <IconButton label="Clear result" onClick={scanner.clear}>
              <X size={14} />
            </IconButton>
          )}
        </>
      }
    >
      {!result ? (
        <Empty title={hasPicture ? "Looking for a code" : "Nothing to scan yet"}>
          {hasPicture ? "Hold a QR code steady in front of the camera, or open an image that contains one." : "Choose your camera or open an image of a QR code. Links get a safety check before you open them."}
        </Empty>
      ) : (
        <motion.div key={result.at} className="scan-result" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", duration: 0.4, bounce: 0 }}>
          <div className="scan-result__head">
            <Tag tone="ice">{kindLabel(result.text)}</Tag>
            <span className="scan-result__scope">Decoded on this Mac</span>
          </div>
          {!secret && <pre className="scan-result__text">{result.text}</pre>}
          <LinkReadout report={report} />
          <WifiReadout text={result.text} />
          {!secret && (
            <div className="scan-actions">
              <CopyButton text={result.text} label="Copy text" />
            </div>
          )}
        </motion.div>
      )}
    </Panel>
  );
}
