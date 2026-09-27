/**
 * Incremental Server-Sent Events parser — mobile twin of
 * packages/sdk-core/src/quantt/sse.ts (see that file for the full
 * rationale). Detached copy for the same reason as lib/quantt.ts: EAS builds
 * can't resolve the workspace @thanos/sdk-core dep. Keep the two identical
 * below this header — packages/sdk-core/src/__tests__/quantt-client.test.ts
 * runs the parser suite against both.
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
