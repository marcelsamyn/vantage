import { expect, test } from "bun:test";
import { buildFleet } from "./nuclear.server";

const NOW = Date.parse("2026-10-09T01:00:00Z") / 1000;

const notice = (unit: string, available: number, start: string, end: string, reason = "Planned maintenance", type = "Planned") => ({
  productionunitname: unit,
  technicalpmax: 1026,
  availablepowerduringoutage: available,
  startdatetime: `${start}T00:00:00+00:00`,
  enddatetime: `${end}T00:00:00+00:00`,
  outagereason: reason,
  type,
  lastupdated: "2026-08-13T12:04:16+00:00",
});

const units = [
  { unit: "DOEL 4", capacityMw: 1026 },
  { unit: "TIHANGE 3", capacityMw: 1030 },
];

test("three filings of one outage become one, and the informative reason wins over 'Other'", () => {
  const fleet = buildFleet(
    {
      units,
      notices: [
        notice("DOEL 4", 0, "2026-03-31", "2026-10-31", "Other"),
        notice("DOEL 4", 0, "2026-04-01", "2026-10-31", "Planned maintenance"),
        notice("DOEL 4", 0, "2027-03-31", "2027-10-31"),
      ],
      everListed: [],
    },
    NOW,
  );
  const doel = fleet.reactors.find((r) => r.unit === "DOEL 4");
  expect(doel?.outages).toHaveLength(2);
  expect(doel?.current?.reason).toBe("Planned maintenance");
  expect(doel?.status).toBe("offline");
  expect(doel?.availableMw).toBe(0);
});

test("start-up ramps and stretch-out curves are not outages, but a deep cut in force still lowers the available power", () => {
  const fleet = buildFleet(
    {
      units,
      notices: [notice("TIHANGE 3", 900, "2026-10-01", "2026-10-30", "Stretch-out curve"), notice("DOEL 4", 400, "2026-10-08", "2026-10-12", "Capacity reduction", "Forced")],
      everListed: [],
    },
    NOW,
  );
  const tihange = fleet.reactors.find((r) => r.unit === "TIHANGE 3");
  expect(tihange?.outages).toHaveLength(0);
  expect(tihange?.status).toBe("reduced");
  expect(tihange?.availableMw).toBe(900);
  const doel = fleet.reactors.find((r) => r.unit === "DOEL 4");
  expect(doel?.current?.type).toBe("Forced");
  expect(doel?.status).toBe("reduced");
});

test("a reactor with no notice is available, and units that left the list are named once", () => {
  const fleet = buildFleet({ units, notices: [], everListed: ["DOEL 1", "DOEL 4", "TIHANGE 1N", "TIHANGE 1S", "TIHANGE 3"] }, NOW);
  expect(fleet.reactors.every((r) => r.status === "available" && r.outages.length === 0)).toBe(true);
  expect(fleet.retired).toEqual(["DOEL 1", "TIHANGE 1"]);
});

test("the placeholder end date of 2099 means no end date", () => {
  const fleet = buildFleet({ units, notices: [notice("DOEL 4", 0, "2025-11-30", "2099-12-31", "No new information")], everListed: [] }, NOW);
  expect(fleet.reactors.find((r) => r.unit === "DOEL 4")?.current?.until).toBeNull();
});
