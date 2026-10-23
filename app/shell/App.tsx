import { useEffect, type ReactElement } from "react";
import { useInterval } from "../core/hooks";
import { useLocation } from "../core/location";
import { Boot } from "./Boot";
import { Ticker, Toasts } from "./Feed";
import { Palette } from "./Palette";
import { ProfileSlot } from "./ProfileSlot";
import { Rail } from "./Rail";
import { Services } from "./Services";
import { Stage } from "./Stage";
import { StatusBar } from "./StatusBar";
import { TabBar } from "./TabBar";
import "./shell.css";

const RELOCATE_MS = 10 * 60_000;

export function App(): ReactElement {
  const locate = useLocation((s) => s.locate);
  useEffect(() => void locate(), [locate]);
  useInterval(() => void locate(), RELOCATE_MS);

  return (
    <div className="shell">
      <Rail />
      <StatusBar />
      <Stage />
      <Ticker />
      <TabBar />
      <ProfileSlot />
      <Toasts />
      <Palette />
      <Services />
      <Boot />
    </div>
  );
}
