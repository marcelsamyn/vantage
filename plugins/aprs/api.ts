import { HttpError, defineSource, ndjson, parseQuery, z } from "../../server/kit";
import { decodePacket } from "./decoder.server";
import { aprsLines, loginLine } from "./stream.server";
import type { AprsEvent } from "./types";

const Box = z.object({
  west: z.coerce.number().finite().min(-180).max(180),
  south: z.coerce.number().finite().min(-90).max(90),
  east: z.coerce.number().finite().min(-180).max(180),
  north: z.coerce.number().finite().min(-90).max(90),
}).refine((b) => b.west !== b.east && b.south < b.north, "Use a geographic box from southwest to northeast");
const Line = z.string().max(510).refine((s) => !/[\r\n]/.test(s), "APRS-IS sent a multiline packet");
const HOSTS = ["euro.aprs2.net", "noam.aprs2.net"] as const;
let attempt = 0;

export default defineSource({
  routes: {
    "GET /stream": (req) => {
      const box = parseQuery(req, Box);
      const call = process.env.VANTAGE_APRS_CALLSIGN;
      if (!call) throw new HttpError(503, "aprs_setup", "Set VANTAGE_APRS_CALLSIGN to your amateur radio callsign and restart VANTAGE to receive APRS stations");
      let login: string;
      try { login = loginLine(call, box); }
      catch (error) { throw new HttpError(503, "aprs_setup", error instanceof Error ? error.message : String(error)); }
      const host = HOSTS[attempt++ % HOSTS.length]!;
      const source = aprsLines({ host, port: 14580 }, login, req.signal);
      // The wrapper passes return directly through so cancellation also closes a pending TCP read.
      return ndjson({
        [Symbol.asyncIterator](): AsyncIterator<AprsEvent> {
          const iterator = source[Symbol.asyncIterator]();
          let verifiedLogin = false;
          return {
            async next(): Promise<IteratorResult<AprsEvent>> {
              try {
                for (;;) {
                  const next = await iterator.next();
                  if (next.done) return { done: true, value: undefined };
                  const raw = Line.parse(next.value);
                  if (raw.startsWith("#")) {
                    if (/^#\s*logresp\b/i.test(raw)) {
                      if (!new RegExp(`^#\\s*logresp ${call.replace(/-/g, "\\-")} unverified(?:,|$)`, "i").test(raw)) throw new Error(`APRS-IS rejected the receive-only login: ${raw}`);
                      verifiedLogin = true;
                    }
                    return { done: false, value: { t: "status", message: `${host}: ${raw}`, live: verifiedLogin } };
                  }
                  if (!verifiedLogin) throw new Error("APRS-IS sent packets before acknowledging the login");
                  const packet = decodePacket(raw, Date.now());
                  if (packet) return { done: false, value: { t: "packet", packet } };
                }
              } catch (error) {
                await iterator.return?.();
                throw error;
              }
            },
            async return(): Promise<IteratorResult<AprsEvent>> {
              await iterator.return?.();
              return { done: true, value: undefined };
            },
          };
        },
      });
    },
  },
});
