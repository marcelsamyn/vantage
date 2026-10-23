import { expect, test } from "bun:test";
import { creditedAuthor } from "./people.server";

test("the register's named author is credited as given", () => {
  expect(creditedAuthor("Borromini Francesco", "maestranze locali")).toBe("Borromini Francesco");
  expect(creditedAuthor("Piacentini Marcello", "maestranze locali")).toBe("Piacentini Marcello");
});

test("with no named author, the workshop or scope stands in", () => {
  expect(creditedAuthor(undefined, "maestranze locali")).toBe("Maestranze Locali");
  expect(creditedAuthor("  ", "maestranze locali")).toBe("Maestranze Locali");
});

test("no author and no scope is null", () => {
  expect(creditedAuthor(undefined, undefined)).toBeNull();
  expect(creditedAuthor("", "")).toBeNull();
});
