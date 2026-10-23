import { expect, test } from "bun:test";
import { deriveSite, GAS_SITES, type GasRow } from "./gas.server";

const row = (operatorKey: string, pointKey: string, directionKey: string, hour: string, value: number | ""): GasRow => ({ operatorKey, pointKey, directionKey, periodFrom: `2026-10-08T${hour}:00:00+02:00`, value });

const site = (id: string) => {
  const def = GAS_SITES.find((s) => s.id === id);
  if (!def) throw new Error(`no site ${id}`);
  return def;
};

test("an Italian border point is its entry minus its exit, in GWh", () => {
  const out = deriveSite(site("it-tarvisio"), [row("IT-TSO-0001", "ITP-00040", "entry", "10", 5_000_000), row("IT-TSO-0001", "ITP-00040", "exit", "10", 1_500_000)]);
  expect(out?.gwh).toBe(3.5);
});

test("gas that Belgium sends into the Netherlands counts against Belgium", () => {
  const out = deriveSite(site("be-zelzate"), [row("NL-TSO-0001", "ITP-00101", "entry", "11", 2_210_000), row("NL-TSO-0001", "ITP-00101", "exit", "11", 0)]);
  expect(out?.gwh).toBe(-2.21);
});

test("hours not reported yet are left out, and the newest reported hour is the reading", () => {
  const out = deriveSite(site("it-mazara"), [
    row("IT-TSO-0001", "ITP-00093", "entry", "09", 25_000_000),
    row("IT-TSO-0001", "ITP-00093", "entry", "10", 26_000_000),
    row("IT-TSO-0001", "ITP-00093", "entry", "11", ""),
  ]);
  expect(out?.series).toHaveLength(2);
  expect(out?.gwh).toBe(26);
});

test("a site with no readings at all is dropped, and other sites' rows are ignored", () => {
  expect(deriveSite(site("it-gela"), [row("IT-TSO-0001", "ITP-00093", "entry", "10", 25_000_000)])).toBeNull();
});
