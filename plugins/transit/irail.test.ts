import { expect, test } from "bun:test";
import { isNearBelgium, irailNear } from "./irail.server";

test("Belgium and its border region count as near", () => {
  expect(isNearBelgium(50.8467, 4.3525)).toBe(true); // Brussels
  expect(isNearBelgium(49.6, 6.1)).toBe(true); // Luxembourg, inside the margin
});

test("Rome and the rest of the world are not near", () => {
  expect(isNearBelgium(41.9028, 12.4964)).toBe(false);
  expect(isNearBelgium(-33.9, 151.2)).toBe(false);
});

test("irailNear answers without any network call outside Belgium", async () => {
  expect(await irailNear(41.9028, 12.4964)).toEqual([]);
});
