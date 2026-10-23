/** Client for the local VANTAGE server. The server validates every upstream feed, so responses are trusted as typed. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function isErrorBody(body: unknown): body is { error: { code: string; message: string } } {
  return typeof body === "object" && body !== null && "error" in body && typeof (body as { error: unknown }).error === "object";
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "offline", "The VANTAGE server is not running. Start it with `bun run dev`.");
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    if (isErrorBody(body)) throw new ApiError(res.status, body.error.code, body.error.message);
    throw new ApiError(res.status, "http", `Request to ${path} failed with HTTP ${res.status}`);
  }
  return body as T;
}

/** Sent with every request that changes something; the server refuses such requests without it. */
const CLIENT_HEADER = "x-vantage";

export function post<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  return api<T>(path, { ...init, method: "POST", headers: { "content-type": "application/json", [CLIENT_HEADER]: "1" }, body: JSON.stringify(body) });
}

/** Build `/path?a=1&b=2`, skipping undefined and null values. */
export function qs(path: string, params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) search.set(k, String(v));
  const s = search.toString();
  return s ? `${path}?${s}` : path;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
