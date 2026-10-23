import { Check, Copy, ExternalLink } from "lucide-react";
import { toCanvas } from "qrcode";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { errorMessage } from "../../app/core/api";
import { Button, Empty, LiveDot, Page, Panel, Scanning, Tag } from "../../app/ui";
import { setSharing, usePhoneStatus } from "./client";
import { ADMIN_DNS_URL, type PhoneStatus } from "./types";
import "./phone.css";

const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";
const QR_SIZE = 512;

export default function PhoneScreen(): ReactElement {
  const { data, error, updatedAt, refresh } = usePhoneStatus();
  // The answer to a share request is shown at once; the next poll takes over again.
  const [changed, setChanged] = useState<PhoneStatus | null>(null);
  useEffect(() => setChanged(null), [updatedAt]);
  const status = changed ?? data;

  return (
    <Page eyebrow="Phone" title="Phone" lede="Open VANTAGE on your phone through Tailscale, from your own tailnet only.">
      {!status && !error && <Scanning label="Asking Tailscale" />}
      {!status && error && (
        <Empty tone="error" title="Could not read the Tailscale setup" action={<Button onClick={refresh}>Try again</Button>}>
          {errorMessage(error)}
        </Empty>
      )}
      {status && (
        <div className="phone-layout">
          <Setup status={status} onChange={setChanged} />
          {status.serving && status.url && <Code url={status.url} />}
        </div>
      )}
    </Page>
  );
}

function Setup({ status, onChange }: { status: PhoneStatus; onChange: (next: PhoneStatus) => void }): ReactElement {
  const running = status.tailscale === "running";
  return (
    <Panel title="Setup" solid actions={<Tag tone={status.serving ? "mint" : undefined}>{status.serving ? "Sharing" : "Not shared"}</Tag>}>
      <ol className="phone-steps">
        <Step n={1} done={running} title="Tailscale on this Mac and on your phone">
          {status.tailscale === "missing" && (
            <>
              Tailscale is not installed on this Mac. <ExtLink href={TAILSCALE_DOWNLOAD_URL}>Download Tailscale</ExtLink>, sign in, then install it on your phone and sign in to the same account.
            </>
          )}
          {status.tailscale === "stopped" && "Tailscale is installed but not connected. Open Tailscale on this Mac and sign in. Then install it on your phone and sign in to the same account."}
          {running && (
            <>
              This Mac is <span className="phone-mono">{status.name}</span> on your tailnet. On your phone, install Tailscale and sign in to the same account.
            </>
          )}
        </Step>
        <Step n={2} done={status.https} title="HTTPS certificates">
          {!running && "Tailscale must be running before this can be checked."}
          {running && status.https && "HTTPS certificates are on for your tailnet."}
          {running && !status.https && (
            <>
              HTTPS certificates are off for your tailnet, and Tailscale Serve needs them. <ExtLink href={ADMIN_DNS_URL}>Turn them on in the Tailscale admin console</ExtLink>, then come back. This page checks every few seconds.
            </>
          )}
        </Step>
        <Step n={3} done={status.serving} title="Share VANTAGE with your devices">
          <Share status={status} onChange={onChange} />
        </Step>
      </ol>
    </Panel>
  );
}

function Share({ status, onChange }: { status: PhoneStatus; onChange: (next: PhoneStatus) => void }): ReactElement {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const ready = status.tailscale === "running" && status.https && !status.otherShare;

  const toggle = (): void => {
    setBusy(true);
    setFailure(null);
    setSharing(!status.serving)
      .then(onChange)
      .catch((err: unknown) => setFailure(errorMessage(err)))
      .finally(() => setBusy(false));
  };

  return (
    <>
      {status.otherShare ? (
        <p>
          Tailscale already shows <span className="phone-mono">{status.otherShare}</span> at <span className="phone-mono">{status.url}</span>. Stop that share in a terminal with{" "}
          <span className="phone-mono">tailscale serve --https=443 off</span>, then share VANTAGE here.
        </p>
      ) : status.serving ? (
        <p>
          VANTAGE is shared at <span className="phone-mono">{status.url}</span>. Devices signed in to your Tailscale account can open it. Stopping removes the share from Tailscale Serve.
        </p>
      ) : (
        <p>
          {status.url ? (
            <>
              Devices signed in to your Tailscale account can open VANTAGE at <span className="phone-mono">{status.url}</span>.
            </>
          ) : (
            "Once Tailscale is running, this button shares VANTAGE at your Mac's Tailscale address."
          )}{" "}
          Other Tailscale accounts are refused unless you list them in <span className="phone-mono">VANTAGE_TAILSCALE_LOGINS</span>.
        </p>
      )}
      <div className="phone-actions">
        <Button variant={status.serving ? "default" : "primary"} disabled={busy || (!status.serving && !ready)} onClick={toggle}>
          {busy ? (status.serving ? "Stopping…" : "Sharing…") : status.serving ? "Stop sharing" : "Share with my devices"}
        </Button>
        {status.serving && (
          <span className="phone-live">
            <LiveDot tone="mint" /> Shared
          </span>
        )}
      </div>
      {failure && <p className="phone-error">{failure}</p>}
    </>
  );
}

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: ReactNode }): ReactElement {
  return (
    <li className="phone-step" data-done={done}>
      <span className="phone-step__n" aria-hidden>
        {done ? <Check size={13} /> : n}
      </span>
      <div className="phone-step__main">
        <h3 className="phone-step__title">
          {title} <span className="phone-step__state">{done ? "Done" : "To do"}</span>
        </h3>
        <div className="phone-step__body">{children}</div>
      </div>
    </li>
  );
}

function ExtLink({ href, children }: { href: string; children: ReactNode }): ReactElement {
  return (
    <a className="phone-link" href={href} target="_blank" rel="noreferrer">
      {children} <ExternalLink size={12} aria-hidden />
    </a>
  );
}

/** The share's address as a QR code in VANTAGE's own ink (near-black on bone), which every phone camera reads. */
function Code({ url }: { url: string }): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let alive = true;
    const css = getComputedStyle(document.documentElement);
    const ink = { dark: css.getPropertyValue("--void").trim(), light: css.getPropertyValue("--bone").trim() };
    toCanvas(canvas, url, { width: QR_SIZE, margin: 2, errorCorrectionLevel: "M", color: ink }).then(
      () => {
        // The library pins the canvas to its pixel size. CSS sizes it instead so it fits any column.
        canvas.style.removeProperty("width");
        canvas.style.removeProperty("height");
        if (alive) setProblem(null);
      },
      (err: unknown) => alive && setProblem(errorMessage(err)),
    );
    return () => {
      alive = false;
    };
  }, [url]);

  useEffect(() => {
    if (copy === "idle") return;
    const timer = setTimeout(() => setCopy("idle"), 2_400);
    return () => clearTimeout(timer);
  }, [copy]);

  const copyLink = (): void => {
    navigator.clipboard.writeText(url).then(
      () => setCopy("copied"),
      () => setCopy("failed"),
    );
  };

  return (
    <Panel title="Open on your phone" solid>
      <div className="phone-code">
        <div className="phone-code__frame">
          <canvas ref={canvasRef} className="phone-code__canvas" aria-label={`QR code for ${url}`} />
        </div>
        {problem && <p className="phone-error">{problem}</p>}
        <p className="phone-code__url phone-mono">{url}</p>
        <div className="phone-actions">
          <Button icon={copy === "copied" ? <Check size={14} /> : <Copy size={14} />} onClick={copyLink}>
            {copy === "copied" ? "Copied" : "Copy link"}
          </Button>
        </div>
        {copy === "failed" && <p className="phone-error">The browser refused to copy. Select the link above and copy it by hand.</p>}
        <p className="phone-tip">On the phone, open the link in Safari and choose Share → Add to Home Screen.</p>
      </div>
    </Panel>
  );
}
