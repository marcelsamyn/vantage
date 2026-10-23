import { z } from "zod";
import { HttpError, describe } from "./http";

const USER_AGENT = "VANTAGE/0.1 (personal open-data dashboard; runs on localhost)";

export interface UpstreamInit extends RequestInit {
  timeoutMs?: number;
  /** Statuses whose bodies the caller must inspect, such as a dataset's empty-result response. */
  acceptedStatuses?: readonly number[];
}

/**
 * Fetch from a public data source. Every failure becomes an HttpError that names the source,
 * so the UI can say exactly which feed is down.
 */
export async function fetchUpstream(source: string, url: string | URL, init: UpstreamInit = {}): Promise<Response> {
  const { timeoutMs = 12_000, acceptedStatuses = [], headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: { "user-agent": USER_AGENT, accept: "application/json, text/plain, */*", ...headers },
      signal: rest.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    throw new HttpError(
      504,
      timedOut ? "upstream_timeout" : "upstream_unreachable",
      timedOut ? `${source} did not answer within ${Math.round(timeoutMs / 1000)} s` : `${source} is unreachable: ${describe(err)}`,
    );
  }
  // With manual redirects, a 3xx is the answer the caller asked for.
  if (!res.ok && !acceptedStatuses.includes(res.status) && !(rest.redirect === "manual" && res.status >= 300 && res.status < 400)) {
    // Release the connection: an unread error body keeps the socket busy and stalls the next request to this host.
    await res.body?.cancel().catch(() => undefined);
    if (res.status === 429) {
      const retry = res.headers.get("retry-after");
      throw new HttpError(503, "upstream_rate_limited", `${source} is rate limiting requests${retry ? `; retry in ${retry} s` : ""}`);
    }
    throw new HttpError(502, "upstream_status", `${source} answered HTTP ${res.status}`);
  }
  return res;
}

export async function fetchJson<S extends z.ZodType>(source: string, url: string | URL, schema: S, init?: UpstreamInit): Promise<z.infer<S>> {
  const res = await fetchUpstream(source, url, init);
  const data: unknown = await res.json().catch(() => {
    throw new HttpError(502, "upstream_shape", `${source} sent a response that is not JSON`);
  });
  return parseUpstream(source, schema, data);
}

export function parseUpstream<S extends z.ZodType>(source: string, schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(502, "upstream_shape", `${source} sent unexpected data: ${z.prettifyError(result.error).slice(0, 300)}`);
  }
  return result.data;
}
