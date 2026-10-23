import { HttpError, fetchJson, memo, z } from "../../server/kit";
import { IDENTITY, fetchText, titleCase } from "./http.server";
import type { Departure, TrainDetail, TrainRef, TripStop } from "./types";

/**
 * Trenitalia ViaggiaTreno: the public JSON behind the viaggiatreno.it web app, covering every train on the
 * Italian network. It publishes no terms, so every call is cached for a minute or more and the credit is shown.
 * The https address redirects to http, so we call http directly.
 */
export const VT_SOURCE = "Trenitalia ViaggiaTreno (RFI, Trenitalia)";
const BASE = "http://www.viaggiatreno.it/infomobilitamobile/resteasy/viaggiatreno";
export const VT_PROBE = `${BASE}/autocompletaStazione/roma`;
const HEADERS = { "user-agent": IDENTITY };

const text = z.string().nullish();
const ms = z.number().nullish();

const VtDeparture = z.object({
  numeroTreno: z.number(),
  categoria: text,
  compNumeroTreno: text,
  destinazione: text,
  codOrigine: text,
  dataPartenzaTreno: ms,
  orarioPartenza: ms,
  ritardo: z.number().nullish(),
  circolante: z.boolean().nullish(),
  provvedimento: z.number().nullish(),
  binarioProgrammatoPartenzaDescrizione: text,
  binarioEffettivoPartenzaDescrizione: text,
});

const VtStop = z.object({
  id: z.string(),
  stazione: z.string(),
  partenza_teorica: ms,
  arrivo_teorico: ms,
  partenzaReale: ms,
  arrivoReale: ms,
  ritardoPartenza: z.number().nullish(),
  ritardoArrivo: z.number().nullish(),
  binarioProgrammatoPartenzaDescrizione: text,
  binarioEffettivoPartenzaDescrizione: text,
  binarioProgrammatoArrivoDescrizione: text,
  binarioEffettivoArrivoDescrizione: text,
  tipoFermata: text,
});

const VtTrain = z.object({
  numeroTreno: z.number(),
  categoria: text,
  compNumeroTreno: text,
  origine: text,
  destinazione: text,
  ritardo: z.number().nullish(),
  stazioneUltimoRilevamento: text,
  oraUltimoRilevamento: ms,
  circolante: z.boolean().nullish(),
  arrivato: z.boolean().nullish(),
  nonPartito: z.boolean().nullish(),
  provvedimento: z.number().nullish(),
  subTitle: text,
  motivoRitardoPrevalente: text,
  anormalita: z.array(z.unknown()).nullish(),
  provvedimenti: z.array(z.unknown()).nullish(),
  segnalazioni: z.unknown().optional(),
  fermate: z.array(VtStop),
  fermateSoppresse: z.array(z.object({ id: z.string() })).nullish(),
});

/** ViaggiaTreno station code for a Transitous stop id: "it-trenitalia_08409" is "S08409". */
export function vtStationCode(transitousStopId: string): string | null {
  const m = /^it-trenitalia_(\d{5})(?::station)?$/.exec(transitousStopId);
  return m ? `S${m[1]}` : null;
}

/**
 * The date text ViaggiaTreno expects in a board request, in Italian time:
 * "Thu Oct 08 2026 22:55:00 GMT+0200". A different shape makes it answer with an empty list.
 */
export function vtDate(at: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Rome",
    weekday: "short",
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(at);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  const offset = get("timeZoneName").replace("GMT", "").replace(":", "") || "+0000";
  return `${get("weekday")} ${get("month")} ${get("day")} ${get("year")} ${get("hour")}:${get("minute")}:${get("second")} GMT${offset}`;
}

const minutes = (m: number | null | undefined): number => (m ?? 0) * 60_000;
const platformOf = (planned: string | null | undefined, actual: string | null | undefined): { track: string | null; changed: boolean } => ({
  track: actual ?? planned ?? null,
  changed: Boolean(planned && actual && planned !== actual),
});

/** Live departures of one station: delay, platform and cancellations for every train in the next hour or two. */
export function vtDepartures(code: string): Promise<Departure[]> {
  return memo(`transit:vt:board:${code}`, 60_000, async () => {
    const rows = await fetchJson("ViaggiaTreno", `${BASE}/partenze/${code}/${encodeURIComponent(vtDate(Date.now()))}`, z.array(VtDeparture), { headers: HEADERS });
    return rows.flatMap((r): Departure[] => {
      if (!r.orarioPartenza) return [];
      const label = (r.compNumeroTreno ?? "").trim() || String(r.numeroTreno);
      const category = (r.categoria ?? "").trim() || label.split(" ")[0] || "";
      const delay = r.circolante ? r.ritardo ?? 0 : 0;
      const { track, changed } = platformOf(r.binarioProgrammatoPartenzaDescrizione, r.binarioEffettivoPartenzaDescrizione);
      return [
        {
          tripId: `it-vt:${r.numeroTreno}:${r.dataPartenzaTreno ?? 0}`,
          route: category,
          headsign: titleCase(r.destinazione ?? ""),
          mode: "REGIONAL_RAIL",
          time: r.orarioPartenza + minutes(delay),
          scheduled: r.orarioPartenza,
          realTime: Boolean(r.circolante),
          cancelled: r.provvedimento === 1,
          track,
          trackChanged: changed,
          agency: "Trenitalia",
          routeColor: null,
          routeTextColor: null,
          accessible: null,
          note: null,
          train: { country: "IT", number: r.numeroTreno, label, origin: r.codOrigine ?? null, dateMs: r.dataPartenzaTreno ?? null },
          occupancy: null,
        },
      ];
    });
  });
}

/** A train's whole run with planned and actual times at every stop. */
export function vtTrain(origin: string, number: number, dateMs: number): Promise<TrainDetail> {
  return memo(`transit:vt:train:${origin}:${number}:${dateMs}`, 45_000, async () => {
    const t = await fetchJson("ViaggiaTreno", `${BASE}/andamentoTreno/${origin}/${number}/${dateMs}`, VtTrain, { headers: HEADERS });
    if (t.fermate.length === 0) throw new HttpError(404, "train_unknown", `ViaggiaTreno has no run of train ${number} on that day`);
    const cancelledStops = new Set((t.fermateSoppresse ?? []).map((s) => s.id));
    const label = (t.compNumeroTreno ?? "").trim() || String(number);

    const stops = t.fermate.map((f): TripStop => {
      const arrivalPlatform = platformOf(f.binarioProgrammatoArrivoDescrizione, f.binarioEffettivoArrivoDescrizione);
      const departurePlatform = platformOf(f.binarioProgrammatoPartenzaDescrizione, f.binarioEffettivoPartenzaDescrizione);
      const platform = departurePlatform.track ?? arrivalPlatform.track;
      const passed = f.partenzaReale != null || f.arrivoReale != null;
      return {
        name: titleCase(f.stazione),
        arrival: f.arrivo_teorico != null || f.arrivoReale != null ? { planned: f.arrivo_teorico ?? null, actual: f.arrivoReale ?? null } : null,
        departure: f.partenza_teorica != null || f.partenzaReale != null ? { planned: f.partenza_teorica ?? null, actual: f.partenzaReale ?? null } : null,
        platform,
        trackChanged: departurePlatform.changed || arrivalPlatform.changed,
        passed,
        cancelled: cancelledStops.has(f.id),
        delayMin: passed ? (f.ritardoPartenza ?? f.ritardoArrivo ?? null) : null,
      };
    });

    const cancelled = t.provvedimento === 1;
    const status: TrainDetail["status"] = cancelled ? "cancelled" : t.arrivato ? "arrived" : t.nonPartito || !t.circolante ? "scheduled" : "running";
    const seen = t.stazioneUltimoRilevamento && t.stazioneUltimoRilevamento !== "--" && t.oraUltimoRilevamento ? { station: titleCase(t.stazioneUltimoRilevamento), at: t.oraUltimoRilevamento } : null;
    const notes = [t.subTitle, t.motivoRitardoPrevalente, ...(t.fermateSoppresse ?? []).map((s) => `Stop cancelled: ${titleCase(t.fermate.find((f) => f.id === s.id)?.stazione ?? s.id)}`)].filter((n): n is string => Boolean(n?.trim()));

    return {
      ref: { country: "IT", number, label, origin, dateMs },
      label,
      operator: "Trenitalia",
      origin: titleCase(t.origine ?? stops[0]?.name ?? ""),
      destination: titleCase(t.destinazione ?? stops[stops.length - 1]?.name ?? ""),
      status,
      delayMin: status === "running" || status === "arrived" ? (t.ritardo ?? 0) : null,
      lastSeen: seen,
      stops,
      notes,
      occupancy: null,
      source: VT_SOURCE,
    };
  });
}

export interface ItalianRun {
  number: number;
  origin: string;
  dateMs: number;
  /** "Laveno Mombello Lago, 08/10/26": where the run starts and its service day. */
  from: string;
}

/** Every run of one train number that ViaggiaTreno knows about. Numbers repeat across origins and days. */
export function vtFindRuns(number: number): Promise<ItalianRun[]> {
  return memo(`transit:vt:find:${number}`, 300_000, async () => {
    const body = await fetchText("ViaggiaTreno", `${BASE}/cercaNumeroTrenoTrenoAutocomplete/${number}`);
    return body
      .split("\n")
      .flatMap((line): ItalianRun[] => {
        const m = /^(\d+) - (.+?) - (\d{2}\/\d{2}\/\d{2})\|\d+-(S\d{5})-(\d+)$/.exec(line.trim());
        return m?.[1] && m[2] && m[3] && m[4] && m[5] ? [{ number: Number(m[1]), origin: m[4], dateMs: Number(m[5]), from: `${titleCase(m[2])}, ${m[3]}` }] : [];
      });
  });
}

/** Resolve a train ref that lacks its origin or service day by looking the number up. Prefers today's run. */
export async function vtResolve(ref: Extract<TrainRef, { country: "IT" }>): Promise<{ origin: string; dateMs: number }> {
  if (ref.origin && ref.dateMs) return { origin: ref.origin, dateMs: ref.dateMs };
  const runs = await vtFindRuns(ref.number);
  const today = runs.filter((r) => Math.abs(r.dateMs - Date.now()) < 36 * 3_600_000);
  const run = (today.length ? today : runs).sort((a, b) => Math.abs(a.dateMs + 43_200_000 - Date.now()) - Math.abs(b.dateMs + 43_200_000 - Date.now()))[0];
  if (!run) throw new HttpError(404, "train_unknown", `ViaggiaTreno does not know train ${ref.number}`);
  return { origin: run.origin, dateMs: run.dateMs };
}
