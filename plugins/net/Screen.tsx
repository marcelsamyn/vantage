import { AnimatePresence, motion } from "motion/react";
import type { ReactElement } from "react";
import { useIntent } from "../../app/core/nav";
import { useStoredState } from "../../app/core/hooks";
import { Page, Segmented } from "../../app/ui";
import { DevicesTab } from "./DevicesTab";
import { OverviewTab } from "./OverviewTab";
import { SpeedTab } from "./SpeedTab";
import { WifiTab } from "./WifiTab";
import { useSpeed } from "./client";
import "./net.css";

type Tab = "overview" | "wifi" | "devices" | "speed";

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "wifi", label: "Wi-Fi" },
  { value: "devices", label: "Devices" },
  { value: "speed", label: "Speed" },
] as const satisfies readonly { value: Tab; label: string }[];

const isTab = (v: string): v is Tab => TABS.some((t) => t.value === v);

export default function NetScreen(): ReactElement {
  const [tab, setTab] = useStoredState<Tab>("net.tab", "overview");

  useIntent("net", (intent) => {
    if (!isTab(intent.action)) return;
    setTab(intent.action);
    // A speed command means "run it now", unless a test is already under way.
    if (intent.action === "speed") useSpeed.getState().start();
  });

  return (
    <Page
      eyebrow="Network"
      title="Network"
      lede="Your Wi-Fi, your devices, your connection."
      actions={
        <div className="net-tabs">
          <Segmented label="Network sections" value={tab} options={TABS} onChange={setTab} />
        </div>
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }} transition={{ type: "spring", duration: 0.35, bounce: 0 }}>
          {tab === "overview" && <OverviewTab />}
          {tab === "wifi" && <WifiTab />}
          {tab === "devices" && <DevicesTab />}
          {tab === "speed" && <SpeedTab />}
        </motion.div>
      </AnimatePresence>
    </Page>
  );
}
