import { defineSource, json, lat, lon, parseQuery, z } from "../../server/kit";
import { factsAt } from "./facts.server";
import { energyAt } from "./fluvius.server";
import { heritageNear } from "./heritage.server";
import { nasoni } from "./nasoni.server";
import { parkingAt } from "./parking.server";
import { tendersAt } from "./tenders.server";
import { remarkableTrees, treeTile, treesNear } from "./trees.server";
import { wifiDay } from "./wifi.server";

/** Oddly specific public records: what the registers say about a spot, and a few layers of them for the map. */

const HERITAGE_RADIUS_M = 40;
const HERITAGE_LIMIT = 3;
const TREE_RADIUS_M = 25;
/** A 25 m circle holds well under 100 street trees. Streets repeat one species along the kerb, so the browser groups identical trees. */
const TREE_LIMIT = 100;

const Spot = z.object({ lat, lon });
const Tile = z.object({ x: z.coerce.number().int().min(0).max(2 ** 17), y: z.coerce.number().int().min(0).max(2 ** 17) });

export default defineSource({
  probes: [
    { name: "Dossier · Fluvius open data", url: "https://opendata.fluvius.be/api/explore/v2.1/catalog/datasets/1_03-verbruiksgegevens-op-straatniveau" },
    { name: "Dossier · Brussels open data", url: "https://opendata.brussels.be/api/explore/v2.1/catalog/datasets/arbres-bomen-vbx-be-bm" },
    { name: "Dossier · Roma Capitale open data", url: "https://dati.comune.roma.it/catalog/api/3/action/package_show?id=atac-003" },
  ],
  routes: {
    "GET /heritage": async (req) => json(await heritageNear(parseQuery(req, Spot), HERITAGE_RADIUS_M, HERITAGE_LIMIT), { maxAge: 300 }),
    "GET /energy": async (req) => json(await energyAt(parseQuery(req, Spot)), { maxAge: 300 }),
    "GET /trees": async (req) => json(await treesNear(parseQuery(req, Spot), TREE_RADIUS_M, TREE_LIMIT), { maxAge: 300 }),
    "GET /parking": async (req) => json(await parkingAt(parseQuery(req, Spot)), { maxAge: 300 }),
    "GET /tenders": async (req) => {
      const at = parseQuery(req, Spot);
      return json(await tendersAt(at.lat, at.lon), { maxAge: 600 });
    },
    "GET /facts": async (req) => json({ facts: await factsAt(parseQuery(req, Spot)) }, { maxAge: 60 }),
    "GET /trees/remarkable": async () => json(await remarkableTrees(), { maxAge: 3600 }),
    "GET /trees/tile": async (req) => {
      const t = parseQuery(req, Tile);
      return json(await treeTile(t.x, t.y), { maxAge: 3600 });
    },
    "GET /nasoni": async () => json(await nasoni(), { maxAge: 3600 }),
    "GET /wifi": async () => json(await wifiDay(), { maxAge: 3600 }),
  },
});
