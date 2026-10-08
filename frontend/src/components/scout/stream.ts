/**
 * The wire format of POST /api/scout, mirrored from the API's
 * scout/workit_scout/schemas.py — change both or neither.
 *
 * The reply is NDJSON: one JSON event per line. Lines arrive in arbitrary
 * network chunks, so a chunk can end mid-line; the remainder waits in `buffer`
 * for the next one.
 */

export type ScoutMessage = { role: "user" | "assistant"; content: string };

export type ScoutEvent = { type: "text"; delta: string } | { type: "error"; message: string };

export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ScoutEvent> {
  const reader = body.getReader();
  // stream: true holds back a multi-byte character split across two chunks.
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) yield JSON.parse(line) as ScoutEvent;
  }
  if (buffer.trim()) yield JSON.parse(buffer) as ScoutEvent;
}
