import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type ReactElement } from "react";
import type { HealthReport } from "../../shared/health";
import { api } from "../core/api";
import { fmt } from "../core/format";
import { useLocation } from "../core/location";
import { allPlugins } from "../core/plugin";
import { sfx } from "../core/sound";
import { Scramble } from "../ui";

const SESSION_KEY = "vantage:booted";

function alreadyBooted(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

async function sensorStates(): Promise<string> {
  const names = ["camera", "microphone", "geolocation"] as const;
  const states = await Promise.all(
    names.map(async (name) => {
      try {
        const s = await navigator.permissions.query({ name: name as PermissionName });
        return `${name === "geolocation" ? "GPS" : name.slice(0, 3).toUpperCase()} ${s.state === "granted" ? "ON" : s.state === "denied" ? "OFF" : "ASK"}`;
      } catch {
        return `${name.slice(0, 3).toUpperCase()} ?`;
      }
    }),
  );
  return states.join(" · ");
}

/**
 * Boot sequence, once per browser session. Every line reports a real check:
 * plugins loaded, where you are, which public feeds answer, which sensors are allowed.
 */
export function Boot(): ReactElement | null {
  const [visible, setVisible] = useState(() => !alreadyBooted());
  const [health, setHealth] = useState<string | null>(null);
  const [sensors, setSensors] = useState<string | null>(null);
  const here = useLocation((s) => s.here);
  const status = useLocation((s) => s.status);

  useEffect(() => {
    if (!visible) return;
    api<HealthReport>("/api/core/health")
      .then((h) => {
        const up = h.probes.filter((p) => p.ok).length;
        setHealth(`${up}/${h.probes.length} ONLINE`);
      })
      .catch(() => setHealth("SERVER OFFLINE"));
    void sensorStates().then(setSensors);
  }, [visible]);

  const where =
    status === "locating" && !here
      ? null
      : here
        ? `${here.source === "gps" ? `GPS ±${fmt.int(here.accuracyM ?? 0)} M` : here.source === "ip" ? "NETWORK · CITY-LEVEL" : "PINNED"}${here.label ? ` · ${here.label}` : ""}`
        : "UNKNOWN";
  const ready = health !== null && sensors !== null && where !== null;

  const dismiss = (): void => {
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      /* private mode: boot shows again next load, which is fine */
    }
    sfx.boot();
    setVisible(false);
  };

  useEffect(() => {
    if (!visible) return;
    const onKey = (): void => dismiss();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible]);

  useEffect(() => {
    if (!ready || !visible) return;
    const t = setTimeout(dismiss, 3200);
    return () => clearTimeout(t);
  }, [ready, visible]);

  const lines: [string, string | null][] = [
    ["Kernel", `v0.1 · ${allPlugins().length} plugins`],
    ["Location", where],
    ["Open data links", health],
    ["Local sensors", sensors],
  ];

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="boot"
          onClick={dismiss}
          exit={{ clipPath: "inset(0 0 100% 0)", transition: { duration: 0.55, ease: [0.65, 0, 0.35, 1] } }}
          role="dialog"
          aria-label="Starting VANTAGE"
        >
          <div className="boot__inner">
            <div className="boot__word">
              <Scramble text="VANTAGE" duration={900} />
            </div>
            <motion.div className="boot__rule" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.9, ease: [0.2, 0, 0, 1], delay: 0.2 }} />
            <div className="boot__lines">
              {lines.map(([key, value], i) => (
                <motion.div key={key} className="boot__line" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.45 + i * 0.16, duration: 0.25 }}>
                  <span className="boot__key">{key}</span>
                  <span className="boot__dots" aria-hidden />
                  <span className={`boot__val ${value === null ? "faint" : value.includes("OFFLINE") ? "alarm" : "ice"}`}>
                    {value === null ? "…" : <Scramble text={value.toUpperCase()} duration={420} />}
                  </span>
                </motion.div>
              ))}
            </div>
            <motion.p className="boot__tagline" initial={{ opacity: 0 }} animate={{ opacity: ready ? 1 : 0 }} transition={{ duration: 0.5 }}>
              Everything is connected.
            </motion.p>
            <motion.div className="boot__prompt" initial={{ opacity: 0 }} animate={{ opacity: ready ? 1 : 0 }}>
              PRESS ANY KEY
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
