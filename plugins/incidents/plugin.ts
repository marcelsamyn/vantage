import { definePlugin } from "../../app/core/plugin";
import { MAP_INK } from "../city/extension";

export default definePlugin({
  id: "incidents", name: "Emergency incidents", description: "Operational incidents in Portugal and Australia, and recent Seattle fire and medical dispatches, with each source's status, times and resources.",
  contributes: {
    profilers: { incident: () => import("./IncidentProfile") },
    thingTypes: [{ id: "incident", title: "Emergency incidents", group: "hazards", tone: "sodium", order: 10, nearby: false, defaultOn: true, mergeM: 0, description: "Portugal, Victoria, New South Wales and Seattle only. Each source publishes different incident types and status details. Seattle records do not confirm that a response is still active.", icon: () => import("lucide-react").then((m) => m.Siren) }],
    thingSources: [
      { id: "incidents.portugal", title: "Mainland Portugal · ANEPC · 2 min", types: ["incident"], refreshMs: 120_000, attribution: "ANEPC · CC BY 4.0", load: () => import("./things-portugal") },
      { id: "incidents.victoria", title: "Victoria · VicEmergency · 2 min", types: ["incident"], refreshMs: 120_000, attribution: "VicEmergency · Country Fire Authority", load: () => import("./things-victoria") },
      { id: "incidents.nsw", title: "New South Wales · RFS · 30 min", types: ["incident"], refreshMs: 1_800_000, attribution: "© State of New South Wales (NSW Rural Fire Service). For current information go to www.rfs.nsw.gov.au. CC BY 4.0.", load: () => import("./things-nsw") },
      { id: "incidents.seattle", title: "Seattle · Fire 911 · last 48 hours · 5 min", types: ["incident"], refreshMs: 300_000, attribution: "Seattle Fire Department · City of Seattle Open Data", load: () => import("./things-seattle") },
    ],
    mapLayers: [{ id: "incidents.nsw-areas", title: "Fire outlines · New South Wales", group: "hazards", swatch: MAP_INK.sodium, description: "Fire outlines published by NSW RFS in New South Wales, Australia. Refresh every 30 minutes. Some incidents have no outline; their position may be a local government area centre.", attribution: "© State of New South Wales (NSW Rural Fire Service). For current information go to www.rfs.nsw.gov.au. CC BY 4.0.", view: () => import("./NswLayer") }],
  },
});
