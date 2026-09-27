/**
 * Incremental `text/event-stream` parser for Quantt's SSE endpoints.
 *
 * Quantt's streams (agent decisions, telemetry, market ticks) accept ONLY a
 * bearer token — no query-param or cookie auth — so native EventSource, which
 * can't send headers, is out; the client reads them over an authed fetch()
 * instead and feeds the body through this parser.
 *
 * Follows the WHATWG event-stream rules that matter here: an event ends at a
 * blank line, CR / LF / CRLF all end a line (a CRLF split across two chunks is
 * handled), `data:` lines join with "\n", lines starting with ":" are comments,
 * one leading space after the colon is dropped, the event type defaults to
 * "message", and a block with no data dispatches nothing.
 */
export interface SseEvent {
  event: string;
  data: string;
  id?: string;
}

export class SseParser {
  private buf = '';
  private type = '';
  private data: string[] = [];
  private id: string | undefined;

  /** Feed the next decoded chunk; returns the events it completed. */
  push(chunk: string): SseEvent[] {
    this.buf += chunk;
    const out: SseEvent[] = [];
    let start = 0;
    for (;;) {
      let end = start;
      while (end < this.buf.length && this.buf[end] !== '\n' && this.buf[end] !== '\r') end++;
      if (end >= this.buf.length) break;                           // no complete line yet
      if (this.buf[end] === '\r' && end + 1 >= this.buf.length) break; // may be half a CRLF
      const line = this.buf.slice(start, end);
      start = end + (this.buf[end] === '\r' && this.buf[end + 1] === '\n' ? 2 : 1);
      const ev = this.line(line);
      if (ev) out.push(ev);
    }
    this.buf = this.buf.slice(start);
    return out;
  }

  private line(line: string): SseEvent | null {
    if (line === '') {
      const ev = this.data.length ? { event: this.type || 'message', data: this.data.join('\n'), id: this.id } : null;
      this.type = '';
      this.data = [];
      return ev;
    }
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.type = value;
    else if (field === 'data') this.data.push(value);
    else if (field === 'id' && !value.includes('\0')) this.id = value;
    return null;
  }
}
