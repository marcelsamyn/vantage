import { createRoot } from "react-dom/client";
import { plugins } from "../plugins";
import { startMotionPolicy } from "./core/motion";
import { startNavigation } from "./core/nav";
import { installPlugins } from "./core/plugin";
import { App } from "./shell/App";
import { addLaunchScreens } from "./shell/launchScreens";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/ui.css";

installPlugins(plugins);
startNavigation();
startMotionPolicy();

const root = document.getElementById("root");
if (!root) throw new Error("index.html is missing #root");
// A page that frames VANTAGE could trick clicks onto its controls. Production also sends frame-ancestors 'none',
// but the development server cannot add headers to its HTML bundle, so the app itself refuses to start in a frame.
if (window.top !== window.self) throw new Error("VANTAGE does not run inside another page");
createRoot(root).render(<App />);
// Drawing the launch images takes a moment; it waits until the page has loaded.
window.addEventListener("load", addLaunchScreens, { once: true });
