import { definePlugin } from "../../app/core/plugin";
export default definePlugin({ id: "charging", name: "Live charging", description: "Live EV connector availability and power levels from TomTom, alongside mapped charging stations.", contributes: {
  thingSources: [{ id: "charging.tomtom", title: "TomTom charging availability", types: ["ev"], minZoom: 13, refreshMs: 3 * 60_000, order: 20,
    attribution: "EV charging: © TomTom", load: () => import("./things") }],
} });
