import { describe, expect, test } from "bun:test";
import { micItem } from "./nearby";
import type { Microphone } from "./types";

const mic: Microphone = {
  id: "ls-563",
  source: "locustream",
  name: "Rue de la Poudrière",
  place: "Bruxelles",
  country: "BE",
  lat: 50.8375,
  lon: 4.3325,
  timezone: "Europe/Brussels",
  format: "mp3",
  stream: "https://stream.example/563.mp3",
  live: true,
  homepage: "https://locusonus.example/map",
};

describe("micItem", () => {
  test("a microphone is something to act on now: Listen, with the project page after", () => {
    const item = micItem(mic, { id: "locustream", name: "Locustream", url: "https://locusonus.example", licence: "Open" });
    expect(item).toMatchObject({ kind: "do", live: true, primary: { label: "Listen" }, detail: "Bruxelles · Locustream · live sound" });
    expect(item.more?.map((a) => a.label)).toEqual(["Project page"]);
  });

  test("leaves the project out of the detail when its credit is unknown", () => {
    expect(micItem(mic, undefined).detail).toBe("Bruxelles · live sound");
  });
});
