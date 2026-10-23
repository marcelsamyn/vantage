import { z } from "zod";
import { log } from "./log";

/** An error that maps directly onto an HTTP response. Throw it anywhere in a handler. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export function json(data: unknown, init: ResponseInit & { maxAge?: number } = {}): Response {
  const { maxAge, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", maxAge ? `private, max-age=${maxAge}` : "no-store");
  return new Response(JSON.stringify(data), { ...rest, headers });
}

export function errorResponse(err: unknown, req: Request): Response {
  const path = new URL(req.url).pathname;
  if (err instanceof HttpError) {
    if (err.status >= 500) log.warn("request failed", { path, code: err.code, message: err.message });
    return json({ error: { code: err.code, message: err.message } } satisfies ApiErrorBody, { status: err.status });
  }
  log.error("unhandled error", { path, error: describe(err), stack: err instanceof Error ? err.stack : undefined });
  return json({ error: { code: "internal", message: describe(err) } } satisfies ApiErrorBody, { status: 500 });
}

/** Parse the query string with a zod schema. Invalid input becomes a 400 that names the bad field. */
export function parseQuery<S extends z.ZodType>(req: Request, schema: S): z.infer<S> {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const result = schema.safeParse(params);
  if (!result.success) throw new HttpError(400, "bad_query", z.prettifyError(result.error));
  return result.data;
}

export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  // A JSON content type cannot be sent cross-site without a CORS preflight, which this server never grants.
  if (!/^application\/json\s*(;|$)/i.test(req.headers.get("content-type") ?? "")) {
    throw new HttpError(415, "bad_content_type", "Send the request body as JSON with content-type: application/json");
  }
  const body: unknown = await req.json().catch(() => {
    throw new HttpError(400, "bad_body", "Request body is not valid JSON");
  });
  const result = schema.safeParse(body);
  if (!result.success) throw new HttpError(400, "bad_body", z.prettifyError(result.error));
  return result.data;
}

/**
 * A link or media address from a third-party feed, or null when it is not a valid http(s) URL.
 * Feeds end up in `href` and `src`, where a `javascript:` or `data:` value would run in the app.
 */
export function webUrl(value: string | null | undefined): string | null {
  if (!value || !URL.canParse(value)) return null;
  const { protocol } = new URL(value);
  return protocol === "https:" || protocol === "http:" ? value : null;
}

export function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Common query fields. */
export const lat = z.coerce.number().min(-90).max(90);
export const lon = z.coerce.number().min(-180).max(180);
