import { HttpError, defineSource, json, lat, lon, parseQuery, z } from "../../server/kit";
import { birdsNear, streamClip } from "./birds.server";
import { hlsPlaylist, microphones, relayStream } from "./mics.server";
import { meteorDetail, meteorNight } from "./meteors.server";
import type { BirdWindow, MeteorArea } from "./types";

/**
 * Listen: open microphones, birdsong near you, and last night's meteors.
 * Sources: Locus Sonus Locustream, Orcasound, BirdWeather, Global Meteor Network. See each *.server.ts.
 */

const MIC_ID = /^(ls-\d+|oc-[a-z0-9-]+)$/;
const CLIP_KEY = /^[0-9a-f]{24}$/;
const METEOR_ID = /^\d{14}_[A-Za-z0-9]{5}$/;

function param(value: string | undefined, pattern: RegExp, what: string, example: string): string {
  if (!value || !pattern.test(value)) throw new HttpError(400, "bad_id", `A ${what} id looks like ${example}`);
  return value;
}

const BirdsQuery = z.object({ lat, lon, window: z.enum(["hour", "day"]).default("hour") satisfies z.ZodType<BirdWindow> });
const MeteorsQuery = z.object({ area: z.enum(["europe", "world"]).default("europe") satisfies z.ZodType<MeteorArea> });

export default defineSource({
  probes: [
    { name: "Open microphones · Locus Sonus", url: "https://locusonus.org/soundmap/list/active/json/name" },
    { name: "Hydrophones · Orcasound", url: "https://live.orcasound.net/api/json/feeds" },
  ],
  routes: {
    "GET /mics": async () => json(await microphones()),

    "GET /stream/:id": (req) => relayStream(req, param(req.params.id, /^ls-\d+$/, "Locustream microphone", "ls-563")),

    "GET /hls/:id": async (req) => json(await hlsPlaylist(param(req.params.id, MIC_ID, "hydrophone", "oc-sunset-bay"))),

    "GET /birds": async (req) => {
      const q = parseQuery(req, BirdsQuery);
      return json(await birdsNear(q.lat, q.lon, q.window));
    },

    "GET /birds/clip/:key": (req) => streamClip(req, param(req.params.key, CLIP_KEY, "recording", "9f2c4a1e7b3d5c60a8e1f4b2")),

    "GET /meteors": async (req) => json(await meteorNight(parseQuery(req, MeteorsQuery).area)),

    "GET /meteors/:id": async (req) => json(await meteorDetail(param(req.params.id, METEOR_ID, "meteor", "20261007024501_LdiWn"))),
  },
});
