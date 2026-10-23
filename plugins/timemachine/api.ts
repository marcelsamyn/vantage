import { defineSource, json, lat, lon, parseQuery, z } from "../../server/kit";
import { catalog, listEras } from "./catalog.server";
import { coveringEras } from "./coverage.server";
import type { ErasPayload } from "./types";

/** Historical maps and aerial photographs for a place. The browser loads their tiles straight from the publishers. */
export default defineSource({
  probes: [
    { name: "Time machine · NGI Belgium", url: "https://wmts.ngi.be/orthophotos_1970s/1.0.0/orthophoto_1971/default/3857/latest/7/42/65.png" },
    { name: "Time machine · IGN", url: "https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=AN-IGNF_GEOGRAPHICALGRIDSYSTEMS.CASSINI&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM_0_14&TILEMATRIX=0&TILEROW=0&TILECOL=0" },
    { name: "Time machine · NASA GIBS", url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/0/0/0.png" },
  ],
  routes: {
    "GET /eras": async (req) => {
      const q = parseQuery(req, z.object({ lat, lon }));
      const { covered, unreachable } = await coveringEras(catalog(), q.lat, q.lon);
      return json({ eras: listEras(covered), unreachable } satisfies ErasPayload, { maxAge: 600 });
    },
  },
});
