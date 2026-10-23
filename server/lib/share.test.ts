import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { absoluteShareUrls } from "./share";

describe("link previews", () => {
  test("points every preview URL in index.html at the hosted origin", async () => {
    const html = await Bun.file(join(import.meta.dir, "../../app/index.html")).text();
    const hosted = absoluteShareUrls(html, "https://vantage.example.com");
    expect(hosted).toContain('<meta property="og:url" content="https://vantage.example.com/" />');
    expect(hosted).toContain('<meta property="og:image" content="https://vantage.example.com/social/og.jpg" />');
    expect(hosted).toContain('<meta name="twitter:image" content="https://vantage.example.com/social/og.jpg" />');
    expect(hosted.match(/content="\/[^"]*"/g)).toBeNull();
  });

  test("leaves other root-relative links alone", () => {
    const html = '<link rel="manifest" href="/manifest.json" /><meta name="og:image:alt" content="/x" />';
    expect(absoluteShareUrls(html, "https://vantage.example.com")).toBe(html);
  });
});
