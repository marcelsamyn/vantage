import { expect, test } from "bun:test";
import { biggest, deadlineWords, money } from "./tender-format";
import { cityNames, cityOf, decodeEntities, splitTitle, toTender, type TedNotice } from "./tenders.server";

const notice = (over: Partial<TedNotice> = {}): TedNotice => ({
  "publication-number": "619441-2026",
  "publication-date": "2026-09-09+02:00",
  "notice-title": { eng: "Italy – Cleaning services of transport equipment – Pa n 16/2026 – in 2 lotti", ita: "Italia – altro" },
  "buyer-name": { ita: ["Cotral Spa &amp; figli"] },
  "total-value": 7_514_413.23,
  "total-value-cur": ["EUR"],
  "estimated-value-lot": ["3922836.16", "3591577.07"],
  "estimated-value-cur-lot": ["EUR"],
  "deadline-receipt-tender-date-lot": ["2026-10-08+02:00", "2026-10-12+02:00"],
  "contract-nature": ["services", "services"],
  ...over,
});

test("a TED title splits into category and the buyer's own title, even when that title holds a dash", () => {
  expect(splitTitle("Italy – Cleaning services – Pa n 16/2026 – in 2 lotti")).toEqual({ category: "Cleaning services", title: "Pa n 16/2026 – in 2 lotti" });
  expect(splitTitle(undefined).title).toBe("Untitled notice");
});

test("HTML entities in notice text are decoded, and an unknown one is left as it came", () => {
  expect(decodeEntities("identit&#224; &amp; &#x4e2d; &bogus;")).toBe("identità & 中 &bogus;");
});

test("a notice becomes a tender: english title, the latest deadline, a link on ted.europa.eu", () => {
  const t = toTender(notice());
  expect(t).toMatchObject({ id: "619441-2026", published: "2026-09-09", category: "Cleaning services of transport equipment", value: 7_514_413, currency: "EUR", deadline: "2026-10-12", nature: "services", buyer: "Cotral Spa & figli" });
  expect(t.url).toBe("https://ted.europa.eu/en/notice/-/detail/619441-2026");
});

test("a notice with no value or deadline says so with nulls, not zeros", () => {
  const t = toTender(notice({ "total-value": null, "total-value-cur": null, "estimated-value-lot": undefined, "deadline-receipt-tender-date-lot": undefined }));
  expect(t.value).toBeNull();
  expect(t.deadline).toBeNull();
});

test("city names carry the local spelling and nothing that could change the query", () => {
  expect(cityNames("Rome")).toEqual(["Rome", "Roma"]);
  expect(cityNames('Ghent") OR buyer-country=ITA OR ("')).toEqual(["Ghent OR buyer-countryITA OR"]);
  expect(cityOf("Esquilino, Rome")).toBe("Rome");
  expect(cityOf("Brussels")).toBe("Brussels");
});

test("money is compact, and deadlines read in days", () => {
  expect(money(284_000, "EUR")).toBe("€284K");
  expect(money(21_600_000, "EUR")).toBe("€21.6M");
  expect(deadlineWords("2026-10-12", "2026-10-09")).toBe("closes in 3 days (12 Oct)");
  expect(deadlineWords("2026-10-09", "2026-10-09")).toBe("closes today");
  expect(deadlineWords("2026-10-03", "2026-10-09")).toBe("closed 3 Oct");
  expect(deadlineWords(null, "2026-10-09")).toBeNull();
});

test("the biggest tenders skip notices that state no value", () => {
  const list = [toTender(notice({ "publication-number": "1" })), toTender(notice({ "publication-number": "2", "total-value": null, "estimated-value-lot": undefined })), toTender(notice({ "publication-number": "3", "total-value": 9_000_000 }))];
  expect(biggest(list, 5).map((t) => t.id)).toEqual(["3", "1"]);
});
