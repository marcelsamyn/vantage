import { describe, expect, test } from "bun:test";
import { parseUpstream } from "../../server/kit";
import { PlanespottersAnswer, adsbdbPhoto, imageUrl, planespottersPhoto } from "./photo.server";

/** The shape api.planespotters.net/pub/photos/hex/<hex> answers with. */
const spotted = (photos: unknown[]): unknown => ({ photos });
const shot = {
  id: "1702451",
  thumbnail: { src: "https://t.plnspttrs.net/38209/1702451_6a1b4c2f9e_t.jpg", size: { width: 200, height: 133 } },
  thumbnail_large: { src: "https://t.plnspttrs.net/38209/1702451_6a1b4c2f9e_280.jpg", size: { width: 420, height: 280 } },
  link: "https://www.planespotters.net/photo/1702451/ei-efy-ryanair-boeing-737-8as-wl",
  photographer: "Jan Peeters ",
};
const parse = (data: unknown): ReturnType<typeof planespottersPhoto> => planespottersPhoto(parseUpstream("Planespotters.net", PlanespottersAnswer, data));

describe("Planespotters answers", () => {
  test("the first photo gives the large image, the small one, the photographer and the page", () => {
    expect(parse(spotted([shot]))).toEqual({
      src: "https://t.plnspttrs.net/38209/1702451_6a1b4c2f9e_280.jpg",
      thumb: "https://t.plnspttrs.net/38209/1702451_6a1b4c2f9e_t.jpg",
      photographer: "Jan Peeters",
      source: "Planespotters.net",
      link: "https://www.planespotters.net/photo/1702451/ei-efy-ryanair-boeing-737-8as-wl",
    });
  });

  test("an airframe nobody photographed has no photo", () => {
    expect(parse(spotted([]))).toBeNull();
  });

  test("without a large image the small one fills the header", () => {
    const { thumbnail_large: _, ...small } = shot;
    expect(parse(spotted([small]))?.src).toBe(shot.thumbnail.src);
  });

  test("a photo whose image or page is not a web address is skipped for the next one", () => {
    const bad = { ...shot, link: "javascript:alert(1)" };
    const next = { ...shot, link: "https://www.planespotters.net/photo/1702452/ei-efy", photographer: "Ana Ruiz" };
    expect(parse(spotted([bad, next]))?.photographer).toBe("Ana Ruiz");
    expect(parse(spotted([{ ...shot, thumbnail: { src: "data:image/png;base64,AAAA" } }]))).toBeNull();
  });

  test("an error answer is reported as unexpected data, not as an empty result", () => {
    expect(() => parse({ error: "Server User-Agent strings must include a contact URL or email" })).toThrow("Planespotters.net sent unexpected data");
  });
});

describe("adsbdb photo fields", () => {
  test("the full photo fills the header, the thumbnail the lists, and the file name gives the photo's page", () => {
    expect(
      adsbdbPhoto({
        url_photo: "https://image.airport-data.com/aircraft/001671344.jpg",
        url_photo_thumbnail: "https://airport-data.com/images/aircraft/thumbnails/001/671/001671344.jpg",
      }),
    ).toEqual({
      src: "https://image.airport-data.com/aircraft/001671344.jpg",
      thumb: "https://airport-data.com/images/aircraft/thumbnails/001/671/001671344.jpg",
      photographer: null,
      source: "Airport-Data.com",
      link: "https://airport-data.com/aircraft/photo/001671344",
    });
  });

  test("one field is enough", () => {
    expect(adsbdbPhoto({ url_photo: "https://image.airport-data.com/aircraft/950990.jpg", url_photo_thumbnail: null })?.thumb).toBe("https://image.airport-data.com/aircraft/950990.jpg");
  });

  test("an image on another host is dropped, and a good thumbnail still shows", () => {
    expect(adsbdbPhoto({ url_photo: "https://cdn.example.org/aircraft/001671344.jpg" })).toBeNull();
    const photo = adsbdbPhoto({ url_photo: "https://evil.example/x.jpg", url_photo_thumbnail: "https://image.airport-data.com/aircraft/950990.jpg" });
    expect(photo?.src).toBe("https://image.airport-data.com/aircraft/950990.jpg");
    expect(photo?.link).toBe("https://airport-data.com/aircraft/photo/950990");
  });

  test("no usable address means no photo", () => {
    expect(adsbdbPhoto(null)).toBeNull();
    expect(adsbdbPhoto({ url_photo: null, url_photo_thumbnail: null })).toBeNull();
    expect(adsbdbPhoto({ url_photo: "javascript:alert(1)", url_photo_thumbnail: "data:text/html,<script>1</script>" })).toBeNull();
  });
});

describe("image hosts", () => {
  test("only the photo sources' hosts pass", () => {
    expect(imageUrl("https://t.plnspttrs.net/38209/a_t.jpg")).not.toBeNull();
    expect(imageUrl("https://airport-data.com/images/a.jpg")).not.toBeNull();
    expect(imageUrl("https://image.airport-data.com/aircraft/1.jpg")).not.toBeNull();
    for (const bad of ["https://evil.example/a.jpg", "https://plnspttrs.net.evil.example/a.jpg", "https://notairport-data.com/a.jpg", "http://127.0.0.1/a.jpg", "ftp://airport-data.com/a.jpg", "javascript:alert(1)"]) expect(imageUrl(bad)).toBeNull();
  });

  test("a Planespotters photo with an image on another host is skipped, and its page link is not an image", () => {
    const off = { ...shot, thumbnail: { src: "https://evil.example/t.jpg" } };
    expect(parse(spotted([off]))).toBeNull();
    const largeOff = { ...shot, thumbnail_large: { src: "https://evil.example/l.jpg" } };
    expect(parse(spotted([largeOff]))?.src).toBe(shot.thumbnail.src);
  });
});
