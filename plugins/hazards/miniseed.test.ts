import { describe, expect, test } from "bun:test";
import { readMiniSeed } from "./miniseed";

/**
 * The fixtures are real downloads from the EarthScope (IRIS) and INGV FDSN services. For two of them the same window was also
 * downloaded as GeoCSV, which the server writes out as plain integers, so the decoded counts are compared with values the
 * data centre itself decompressed.
 */

const fixture = (name: string): Promise<Uint8Array> => Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).bytes();

async function expectedCounts(name: string): Promise<{ t: number; v: number }[]> {
  const text = await Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).text();
  return text
    .split("\n")
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const [time, value] = line.split(",");
      return { t: Date.parse(time ?? ""), v: Number(value) };
    });
}

async function checkAgainstGeoCsv(mseed: string, csv: string, rate: number): Promise<void> {
  const trace = readMiniSeed(await fixture(mseed));
  if (!trace) throw new Error("trace expected");
  expect(trace.sampleRate).toBe(rate);
  const expected = await expectedCounts(csv);
  expect(expected.length).toBe(400);
  for (const { t, v } of expected) {
    const index = Math.round(((t - trace.startMs) / 1000) * rate);
    expect(trace.samples[index]).toBe(v);
  }
}

describe("miniSEED reader", () => {
  test("Steim-1 data from Uccle (BE.UCC) equals the data centre's own decompression", () => checkAgainstGeoCsv("BE.UCC..HHZ.mseed", "BE.UCC..HHZ.counts.csv", 100));

  test("Steim-2 data from Albuquerque (IU.ANMO) equals the data centre's own decompression", () => checkAgainstGeoCsv("IU.ANMO.00.BHZ.mseed", "IU.ANMO.00.BHZ.counts.csv", 40));

  test("INGV data (IV.SAMA) is continuous across record borders", async () => {
    const trace = readMiniSeed(await fixture("IV.SAMA..EHZ.mseed"));
    if (!trace) throw new Error("trace expected");
    expect(trace.sampleRate).toBe(100);
    // The header says day 281 of 2026, 19:59:59 and 9400 ticks of 0.1 ms.
    expect(trace.startMs).toBe(Date.UTC(2026, 9, 8, 19, 59, 59, 940));
    expect(trace.samples.length).toBeGreaterThan(1500);
    expect(trace.samples.every(Number.isFinite)).toBe(true);
    // Neighbouring samples of a geophone trace differ by far less than the full counts range; a broken record border would jump.
    let largest = 0;
    for (let i = 1; i < trace.samples.length; i++) largest = Math.max(largest, Math.abs((trace.samples[i] ?? 0) - (trace.samples[i - 1] ?? 0)));
    const spread = Math.max(...trace.samples) - Math.min(...trace.samples);
    expect(largest).toBeLessThan(Math.max(spread, 1));
  });

  test("returns null for data that is not miniSEED", () => {
    expect(readMiniSeed(new TextEncoder().encode("Error 404: Not Found\n\nno waveform data found\n"))).toBeNull();
    expect(readMiniSeed(new Uint8Array())).toBeNull();
  });
});
