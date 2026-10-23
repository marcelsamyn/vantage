import { expect, test } from "bun:test";
import { tecLine } from "./live.server";

test("tecLine reads the public line number from Liège route ids", () => {
  expect(tecLine("gr:tec:L0033-23467")).toEqual({ route: "33", mode: "BUS" });
  expect(tecLine("gr:tec:L1000-23082")).toEqual({ route: "T1", mode: "TRAM" });
});

test("tecLine leaves the route empty where the code is not a line number", () => {
  expect(tecLine("gr:tec:H2082-24230")).toEqual({ route: "", mode: "BUS" });
  expect(tecLine("")).toEqual({ route: "", mode: "BUS" });
});
