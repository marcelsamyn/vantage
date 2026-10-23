import { defineSource, json, parseBody, parseQuery, z } from "../../server/kit";
import { act, listDevices, pair } from "./devices.server";
import type { ControlDevices, Device } from "./types";

const deviceId = z.string().min(1).max(200);

/** Mounted automatically at /api/control/… */
export default defineSource({
  routes: {
    /** Every device and its state. `refresh=1` starts a new network scan and reads every device again. */
    "GET /devices": async (req) => {
      const { refresh } = parseQuery(req, z.object({ refresh: z.enum(["0", "1"]).optional() }));
      return json((await listDevices(refresh === "1")) satisfies ControlDevices);
    },

    /** Change one capability. The value is checked against what the device reported, never against a host or address. */
    "POST /act": async (req) => {
      const body = await parseBody(req, z.object({ deviceId, capability: z.string().min(1).max(64), value: z.unknown() }));
      return json((await act(body.deviceId, body.capability, body.value)) satisfies Device);
    },

    /** Pair with a bridge after its button was pressed, or let macOS ask whether VANTAGE may control an app. */
    "POST /pair": async (req) => {
      const body = await parseBody(req, z.object({ deviceId }));
      return json((await pair(body.deviceId)) satisfies Device);
    },
  },
});
