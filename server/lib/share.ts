/** The link-preview tags in app/index.html that name a page or image by URL. */
const URL_TAGS = /(<meta (?:property|name)="(?:og:url|og:image|twitter:image)" content=")\/([^"]*")/g;

/**
 * Make the link-preview URLs in index.html absolute. Facebook, LinkedIn and X ignore a root-relative og:image, and the
 * page cannot know its own origin, so the hosted server writes VANTAGE_ORIGIN into the built page.
 */
export function absoluteShareUrls(html: string, origin: string): string {
  return html.replace(URL_TAGS, `$1${origin}/$2`);
}
