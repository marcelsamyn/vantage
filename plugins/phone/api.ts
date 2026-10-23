import { defineSource } from "../../server/kit";
import { liveDeps, phoneRoutes } from "./phone.server";

/** Mounted automatically at /api/phone/… `POST /share` changes this Mac's Tailscale Serve settings. */
export default defineSource({ routes: phoneRoutes(liveDeps) });
