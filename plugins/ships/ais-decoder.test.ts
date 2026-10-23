import { describe, expect, test } from "bun:test";
import { AisDecoder, type AisMessage, type AisStatic } from "./ais-decoder";

/**
 * Sentences in the first group are the public examples from the gpsd AIVDM documentation.
 * The second group was produced by an independent encoder (pyais) from the field values written next to each sentence,
 * so the decoder is checked against the values that went in, not against its own output.
 */

function decodeAll(lines: string[]): AisMessage[] {
  const decoder = new AisDecoder();
  return lines.flatMap((line) => decoder.push(line));
}

function only<K extends AisMessage["kind"]>(messages: AisMessage[], kind: K): Extract<AisMessage, { kind: K }> {
  const found = messages.filter((m): m is Extract<AisMessage, { kind: K }> => m.kind === kind);
  expect(found).toHaveLength(1);
  return found[0] as Extract<AisMessage, { kind: K }>;
}

describe("published sample sentences", () => {
  test("type 1 position report off Boston", () => {
    const p = only(decodeAll(["!AIVDM,1,1,,B,15N4cJ`005Jrek0H@9n`DW5608EP,0*13"]), "position");
    expect(p).toMatchObject({ mmsi: 367078250, navStatus: 8, sogKt: 0.5, cogDeg: 213, headingDeg: 226 });
    expect(p.lon).toBeCloseTo(-71.059467, 5);
    expect(p.lat).toBeCloseTo(42.38415, 5);
  });

  test("type 1 position report in the Kattegat", () => {
    const p = only(decodeAll(["!AIVDM,1,1,,A,13u?etPv2;0n:dDPwUM1U1Cb069D,0*24"]), "position");
    expect(p).toMatchObject({ mmsi: 265547250, navStatus: 0, sogKt: 13.9, cogDeg: 40.4, headingDeg: 41 });
    expect(p.lon).toBeCloseTo(11.832977, 5);
    expect(p.lat).toBeCloseTo(57.660353, 5);
  });

  test("type 5 static data arrives in two sentences", () => {
    const s = only(
      decodeAll([
        "!AIVDM,2,1,1,A,55?MbV02;H;s<HtKR20EHE:0@T4@Dn2222222216L961O5Gf0NSQEp6ClRp8,0*1C",
        "!AIVDM,2,2,1,A,88888888880,2*25",
      ]),
      "static",
    );
    expect(s).toMatchObject({ mmsi: 351759000, imo: 9134270, callSign: "3FOF8", name: "EVER DIADEM", toBowM: 225, toSternM: 70, draughtM: 12.2, destination: "NEW YORK" });
    expect(s.eta).toEqual([5, 15, 14, 0]);
  });
});

describe("sentences encoded from known values", () => {
  test("type 1 under way", () => {
    const p = only(decodeAll(["!AIVDO,1,1,,B,13mbHl0P1sPHFtpRSb4a:G<wP000,0*16"]), "position");
    expect(p).toMatchObject({ mmsi: 257595600, navStatus: 0, sogKt: 12.3, cogDeg: 234.5, headingDeg: 230 });
    expect(p.lon).toBeCloseTo(5.32122, 5);
    expect(p.lat).toBeCloseTo(60.39299, 5);
  });

  test("type 2 moored with no heading", () => {
    const p = only(decodeAll(["!AIVDO,1,1,,B,13LBhD50001j=TPRKOL3Q?vIP000,0*78"]), "position");
    expect(p).toMatchObject({ mmsi: 230994000, navStatus: 5, sogKt: 0, cogDeg: 90, headingDeg: null });
    expect(p.lon).toBeCloseTo(24.95, 5);
    expect(p.lat).toBeCloseTo(60.17, 5);
  });

  test("type 3 reads a negative longitude", () => {
    const p = only(decodeAll(["!AIVDO,1,1,,B,13@p:P82i@wd5UPLlVd>3h3oP000,0*34"]), "position");
    expect(p).toMatchObject({ mmsi: 219024000, navStatus: 8, sogKt: 8, cogDeg: 359.9, headingDeg: 1 });
    expect(p.lon).toBeCloseTo(-4.35, 5);
    expect(p.lat).toBeCloseTo(50.37, 5);
  });

  test("southern and western hemispheres are negative, and 360° course means not available", () => {
    const p = only(decodeAll(["!AIVDO,1,1,,B,14`Ut>h001LrHRQjq0d>4;?qP000,0*21"]), "position");
    expect(p.lon).toBeCloseTo(-43.17, 5);
    expect(p.lat).toBeCloseTo(-22.91, 5);
    expect(p.sogKt).toBe(0.1);
    expect(p.cogDeg).toBeNull();
    expect(p.headingDeg).toBe(359);
  });

  test("type 5 static and voyage data over two sentences", () => {
    const s = only(
      decodeAll([
        "!AIVDO,2,1,0,B,53mbHl02>>r8hluH000t@4pD000000000000000N1@B536W6N=PQDQiCP000,0*7D",
        "!AIVDO,2,2,0,B,00000000000,2*25",
      ]),
      "static",
    );
    expect(s).toMatchObject({ mmsi: 257595600, imo: 9321378, callSign: "LMOV", name: "ODANE", shipType: 30, toBowM: 10, toSternM: 18, toPortM: 5, toStarboardM: 3, draughtM: 5.4, destination: "BERGEN" });
    expect(s.eta).toEqual([10, 14, 6, 30]);
  });

  test("type 18 class B position", () => {
    const p = only(decodeAll(["!AIVDO,1,1,,B,B3n:Vh00;`<C4F8TQ6@hT`:00000,0*77"]), "position");
    expect(p).toMatchObject({ mmsi: 258123456, sogKt: 4.6, cogDeg: 77.7, headingDeg: 80, navStatus: null });
    expect(p.lon).toBeCloseTo(10.7461, 5);
    expect(p.lat).toBeCloseTo(59.9127, 5);
  });

  test("type 19 gives a position and the vessel's static data", () => {
    const messages = decodeAll(["!AIVDO,1,1,,B,C3m=TB00Bp5mR@8k3:07P5g0V:304T::l:0000000000BPP21120,0*2D"]);
    expect(messages).toHaveLength(2);
    expect(only(messages, "position")).toMatchObject({ mmsi: 257123400, sogKt: 7.5, cogDeg: 12, headingDeg: 11 });
    expect(only(messages, "static")).toMatchObject({ mmsi: 257123400, name: "SEA BREEZE", shipType: 37, toBowM: 8, toSternM: 4, toPortM: 2, toStarboardM: 2 });
  });

  test("type 24 part A carries the name and part B the type, call sign and size", () => {
    const decoder = new AisDecoder();
    const a = decoder.push("!AIVDO,1,1,,B,H3n311hH`u8B19DppE8000000000,0*4F");
    const b = decoder.push("!AIVDO,1,1,,B,H3n311lT6530000<1ijkl00h3120,0*68");
    expect(only(a, "static")).toMatchObject({ mmsi: 257999111, name: "FJORD RUNNER" });
    expect(only(b, "static")).toMatchObject({ mmsi: 257999111, shipType: 36, callSign: "LA1234", toBowM: 6, toSternM: 3, toPortM: 1, toStarboardM: 2 });
  });
});

describe("stream handling", () => {
  const part1 = "!AIVDO,2,1,0,B,53mbHl02>>r8hluH000t@4pD000000000000000N1@B536W6N=PQDQiCP000,0*7D";
  const part2 = "!AIVDO,2,2,0,B,00000000000,2*25";
  const position = "!AIVDM,1,1,,B,15N4cJ`005Jrek0H@9n`DW5608EP,0*13";

  test("a single-part message between two fragments does not disturb them", () => {
    const messages = decodeAll([part1, position, part2]);
    expect(messages.map((m) => m.kind)).toEqual(["position", "static"]);
    expect((messages[1] as AisStatic).name).toBe("ODANE");
  });

  test("fragments with different sequence ids are kept apart", () => {
    const other1 = "!AIVDM,2,1,1,A,55?MbV02;H;s<HtKR20EHE:0@T4@Dn2222222216L961O5Gf0NSQEp6ClRp8,0*1C";
    const other2 = "!AIVDM,2,2,1,A,88888888880,2*25";
    const names = decodeAll([part1, other1, other2, part2]).map((m) => (m as AisStatic).name);
    expect(names).toEqual(["EVER DIADEM", "ODANE"]);
  });

  test("a lone fragment decodes to nothing", () => {
    expect(decodeAll([part1])).toEqual([]);
  });

  test("a tag block before the sentence is skipped", () => {
    const p = decodeAll([`\\s:2573555,c:1481113191*0D\\${position}`]);
    expect(only(p, "position").mmsi).toBe(367078250);
  });

  test("a line with a wrong checksum is dropped", () => {
    expect(decodeAll(["!AIVDM,1,1,,B,15N4cJ`005Jrek0H@9n`DW5608EP,0*14"])).toEqual([]);
  });

  test("noise and unsupported message types are ignored", () => {
    // Type 4 (base station report) is valid but not decoded.
    expect(decodeAll(["", "garbage", "$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47", "!AIVDO,1,1,,A,403OviQvbTDN?o??E0E`Ah000000,0*71"])).toEqual([]);
  });

  test("a position with longitude 181° and latitude 91° (no fix) is dropped", () => {
    expect(decodeAll(["!AIVDO,1,1,,A,11mg=5@0?w<tSF0l4Q@>4?wqP000,0*69"])).toEqual([]);
  });
});
