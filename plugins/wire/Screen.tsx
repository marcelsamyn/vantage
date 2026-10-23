import { AnimatePresence, motion } from "motion/react";
import type { ReactElement } from "react";
import { useStoredState } from "../../app/core/hooks";
import { useIntent } from "../../app/core/nav";
import { Page, Segmented } from "../../app/ui";
import { ConnectionsTab } from "./ConnectionsTab";
import { PortsTab } from "./PortsTab";
import { TraceTab } from "./TraceTab";
import { useTrace } from "./trace-store";
import "./wire.css";

type Tab = "connections" | "ports" | "trace";

const TABS = [
  { value: "connections", label: "Connections" },
  { value: "ports", label: "Open ports" },
  { value: "trace", label: "Trace" },
] as const satisfies readonly { value: Tab; label: string }[];

const isTab = (v: string): v is Tab => TABS.some((t) => t.value === v);

export default function WireScreen(): ReactElement {
  const [tab, setTab] = useStoredState<Tab>("wire.tab", "connections");

  useIntent("wire", (intent) => {
    if (!isTab(intent.action)) return;
    setTab(intent.action);
    // A trace command with a host means "run it now".
    if (intent.action === "trace" && intent.arg) useTrace.getState().start(intent.arg);
  });

  return (
    <Page
      eyebrow="Wire"
      title="Wire"
      lede="Where your Mac's traffic goes: every server your apps talk to, every door they hold open, and the route a packet takes to a host you pick."
      actions={
        <div className="wire-tabs">
          <Segmented label="Wire sections" value={tab} options={TABS} onChange={setTab} />
        </div>
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }} transition={{ type: "spring", duration: 0.35, bounce: 0 }}>
          {tab === "connections" && <ConnectionsTab />}
          {tab === "ports" && <PortsTab />}
          {tab === "trace" && <TraceTab />}
        </motion.div>
      </AnimatePresence>
    </Page>
  );
}
