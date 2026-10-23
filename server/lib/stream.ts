/**
 * Stream an async iterable to the client as newline-delimited JSON.
 * When the client disconnects, the iterator is closed, which lets generators kill child processes.
 */
export function ndjson(source: AsyncIterable<unknown>): Response {
  const iterator = source[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  // The client can disconnect while `next()` is pending; writing after that throws.
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (cancelled) return;
        if (done) controller.close();
        else controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      } catch (err) {
        if (cancelled) return;
        controller.enqueue(encoder.encode(`${JSON.stringify({ error: { code: "stream_failed", message: err instanceof Error ? err.message : String(err) } })}\n`));
        controller.close();
      }
    },
    async cancel() {
      cancelled = true;
      await iterator.return?.();
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
