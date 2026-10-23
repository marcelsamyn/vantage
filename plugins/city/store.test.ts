import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useCity } from "./store";

const initial = useCity.getState();

beforeEach(() => useCity.setState({ ...initial, chosen: ["power.cuts", "power.gas"], unframed: [], status: {} }));
afterEach(() => useCity.setState(initial, true));

describe("layer framing", () => {
  test("restored layers cannot move the startup camera", () => {
    expect(initial.unframed).toEqual([]);
    expect(useCity.getState().claimFraming("power.cuts")).toBe(false);
    expect(useCity.getState().claimFraming("power.gas")).toBe(false);
  });

  test("switching a layer on allows one framing, including after a remount", () => {
    useCity.getState().toggle("power.flows", true);
    expect(useCity.getState().claimFraming("power.flows")).toBe(true);
    // A remounted layer asks the same store; it must not get another flight.
    expect(useCity.getState().claimFraming("power.flows")).toBe(false);
    useCity.getState().report("power.flows", { loading: false, count: 4 });
    expect(useCity.getState().claimFraming("power.flows")).toBe(false);
  });

  test("switching off cancels framing while data is still loading", () => {
    useCity.getState().toggle("power.cuts", true);
    useCity.getState().toggle("power.cuts", false);
    expect(useCity.getState().claimFraming("power.cuts")).toBe(false);
    expect(useCity.getState().status["power.cuts"]).toEqual({ loading: false, error: null, count: null });
  });

  test("switching a layer back on permits one new framing", () => {
    useCity.getState().toggle("power.gas", true);
    expect(useCity.getState().claimFraming("power.gas")).toBe(true);
    useCity.getState().toggle("power.gas", false);
    useCity.getState().toggle("power.gas", true);
    expect(useCity.getState().claimFraming("power.gas")).toBe(true);
    expect(useCity.getState().claimFraming("power.gas")).toBe(false);
  });

  test("each explicitly enabled layer keeps its own framing request", () => {
    useCity.getState().toggle("power.cuts", true);
    useCity.getState().toggle("transit.works", true);
    expect(useCity.getState().claimFraming("power.cuts")).toBe(true);
    expect(useCity.getState().claimFraming("transit.works")).toBe(true);
    expect(useCity.getState().claimFraming("power.cuts")).toBe(false);
  });
});
