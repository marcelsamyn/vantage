import { describe, expect, test } from "bun:test";
import { buildSnapshot, parseConfig, parseReading } from "./dsn.server";
import { farthestLink } from "./links";

/** Trimmed from a real reading of https://eyes.nasa.gov/dsn/data/dsn.xml, with the feed's habits kept: placeholder power, "NaN" rates, idle dishes aimed at id 99, two downlinks on one dish. */
const READING = `<dsn>
	<station name="gdscc" friendlyName="Goldstone" timeUTC="1791502207000" timeZoneOffset="-25200000.0"/>
	<dish name="DSS14" azimuthAngle="0" elevationAngle="90" windSpeed="" isMSPA="false" isArray="false" isDDOR="false" activity="Engineering Upgrades">
		<target name="DSN" id="99" uplegRange="-1" downlegRange="-1" rtlt="-1"/>
	</dish>
	<dish name="DSS24" azimuthAngle="166" elevationAngle="66" windSpeed="10" isMSPA="false" isArray="false" isDDOR="false" activity="Spacecraft Telemetry, Tracking, and Command">
		<downSignal active="true" signalType="data" dataRate="160" frequency="0" band="X" power="-156" spacecraft="VGR1" spacecraftID="-31"/>
		<upSignal active="true" signalType="carrier" dataRate="0" frequency="0" band="X" power="18" spacecraft="VGR1" spacecraftID="-31"/>
		<target name="VGR1" id="31" uplegRange="25800000000" downlegRange="25800000000" rtlt="-1"/>
	</dish>
	<dish name="DSS25" azimuthAngle="0" elevationAngle="90" windSpeed="" isMSPA="false" isArray="false" isDDOR="false" activity="Spacecraft Telemetry, Tracking, and Command">
		<downSignal active="false" signalType="none" dataRate="NaN" frequency="0" band="X" power="-480" spacecraft="VGR1" spacecraftID="-31"/>
		<target name="VGR1" id="31" uplegRange="25800000000" downlegRange="25800000000" rtlt="-1"/>
	</dish>
	<station name="mdscc" friendlyName="Madrid" timeUTC="1791502207000" timeZoneOffset="7200000.0"/>
	<dish name="DSS53" azimuthAngle="114" elevationAngle="57" windSpeed="0" isMSPA="false" isArray="false" isDDOR="false" activity="Spacecraft Telemetry, Tracking, and Command">
		<downSignal active="true" signalType="data" dataRate="40000" frequency="0" band="S" power="-120" spacecraft="JWST" spacecraftID="-170"/>
		<downSignal active="true" signalType="data" dataRate="28000000" frequency="0" band="K" power="-90" spacecraft="JWST" spacecraftID="-170"/>
		<target name="JWST" id="170" uplegRange="1370000" downlegRange="1370000" rtlt="-1"/>
	</dish>
	<dish name="DSS54" azimuthAngle="198" elevationAngle="36" windSpeed="0" isMSPA="false" isArray="false" isDDOR="false" activity="Spacecraft Telemetry, Tracking, and Command">
		<downSignal active="true" signalType="data" dataRate="160" frequency="0" band="X" power="-155" spacecraft="VGR1" spacecraftID="-31"/>
		<target name="VGR1" id="31" uplegRange="25800000000" downlegRange="25800000000" rtlt="-1"/>
	</dish>
	<timestamp>1791502217000</timestamp>
</dsn>`;

const CONFIG = `<config>
	<sites>
		<site name="mdscc" friendlyName="Madrid" longitude="-4.2480085" latitude="40.2413554">
			<dish name="DSS53" friendlyName="DSS 53" type="34M"></dish>
			<dish name="DSS54" friendlyName="DSS 54" type="34M"></dish>
		</site>
		<site name="gdscc" friendlyName="Goldstone" longitude="-116.8895382" latitude="35.2443523">
			<dish name="DSS14" friendlyName="DSS 14" type="70M"></dish>
			<dish name="DSS24" friendlyName="DSS 24" type="34M"></dish>
			<dish name="DSS25" friendlyName="DSS 25" type="34M"></dish>
		</site>
	</sites>
	<spacecraftMap>
		<spacecraft name="vgr1" explorerName="sc_voyager_1" friendlyName="Voyager 1" thumbnail="true"></spacecraft>
		<spacecraft name="jwst" explorerName="" friendlyName="James Webb Space Telescope" thumbnail="true"></spacecraft>
	</spacecraftMap>
</config>`;

const snapshot = (earthKm: (naifId: number) => number | null = () => null): ReturnType<typeof buildSnapshot> => buildSnapshot(parseReading(READING), parseConfig(CONFIG), earthKm, 1791502220000);

describe("Deep Space Network reading", () => {
  test("puts Madrid first and reads the complexes' local time offsets", () => {
    const { complexes } = snapshot();
    expect(complexes.map((c) => c.name)).toEqual(["Madrid", "Goldstone"]);
    expect(complexes[0]?.utcOffsetMin).toBe(120);
    expect(complexes[1]?.utcOffsetMin).toBe(-420);
  });

  test("reads dish size, pointing and activity", () => {
    const goldstone = snapshot().complexes[1];
    const idle = goldstone?.dishes.find((d) => d.id === "DSS14");
    expect(idle).toMatchObject({ name: "DSS 14", sizeM: 70, azimuthDeg: 0, elevationDeg: 90, onAir: false, targets: [] });
    expect(idle?.activity).toBe("Engineering Upgrades");
  });

  test("treats placeholder values as unknown and keeps a dish with an inactive signal off air", () => {
    const dss25 = snapshot().complexes[1]?.dishes.find((d) => d.id === "DSS25");
    expect(dss25?.onAir).toBe(false);
    expect(dss25?.signals[0]).toMatchObject({ active: false, rateBps: null, powerDbm: null });
    expect(dss25?.targets[0]?.spacecraft).toEqual({ naifId: -31, name: "Voyager 1" });
  });

  test("builds one link per spacecraft and complex, strongest data downlink first, with the network's range as fallback distance", () => {
    const { links } = snapshot();
    const webb = links.find((l) => l.key === "mdscc:-170");
    expect(webb?.downlinks.map((s) => s.band)).toEqual(["K", "S"]);
    expect(webb?.distanceKm).toBe(1_370_000);
    expect(webb?.distanceSource).toBe("dsn");
    const voyager = links.find((l) => l.key === "gdscc:-31");
    expect(voyager?.uplinks[0]?.powerKw).toBe(18);
    expect(voyager?.lightSeconds).toBeCloseTo(25.8e9 / 299_792.458, 0);
  });

  test("prefers a Horizons distance over the network's rounded range", () => {
    const link = snapshot((id) => (id === -31 ? 25_788_873_496 : null)).links.find((l) => l.key === "gdscc:-31");
    expect(link?.distanceKm).toBe(25_788_873_496);
    expect(link?.distanceSource).toBe("horizons");
  });
});

describe("farthestLink", () => {
  test("picks the most distant link", () => {
    const link = farthestLink(snapshot().links);
    expect(link?.spacecraft.name).toBe("Voyager 1");
  });

  test("lets Madrid win when two complexes hear the same spacecraft at the same distance", () => {
    const links = snapshot().links;
    const voyager = links.find((l) => l.key === "gdscc:-31");
    if (!voyager) throw new Error("fixture lost its Voyager link");
    // The same spacecraft heard from Madrid, whose range rounds a hair lower.
    const madrid = { ...voyager, key: "mdscc:-31", complexId: "mdscc" as const, distanceKm: (voyager.distanceKm ?? 0) * 0.999 };
    expect(farthestLink([voyager, madrid])?.complexId).toBe("mdscc");
    expect(farthestLink([madrid, voyager])?.complexId).toBe("mdscc");
  });

  test("returns null when no link has a distance", () => {
    expect(farthestLink([])).toBeNull();
  });
});
