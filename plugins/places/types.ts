/** Payloads served by /api/places: Wikipedia articles about places. */

export interface Article {
  id: number;
  title: string;
  lat: number;
  lon: number;
  description: string | null;
  thumbnail: string | null;
}

export interface ArticleSummary {
  title: string;
  extract: string;
  description: string | null;
  thumbnail: string | null;
  url: string;
}

declare module "../../app/core/plugin" {
  interface EntityKinds {
    article: Article;
  }
}
