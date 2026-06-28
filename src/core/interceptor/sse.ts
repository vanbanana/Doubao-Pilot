export interface SSEEvent {
  type: string;
  data: string;
  id?: string;
}

/**
 * Parses a block of SSE text (one or more `\n\n`-separated events) into events.
 * Tolerant of multi-line `data:` fields and missing `event:`/`id:` lines.
 */
export function parseSSEChunk(chunk: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  for (const block of chunk.split('\n\n')) {
    if (!block.trim()) continue;
    let type: string | undefined;
    let id: string | undefined;
    let data: string | undefined;
    for (const line of block.split('\n')) {
      if (line.startsWith('id:')) {
        id = line.slice(3).trim();
      } else if (line.startsWith('event:')) {
        type = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        const part = line.slice(5).trim();
        data = data != null ? `${data}\n${part}` : part;
      }
    }
    if (data !== undefined) {
      events.push({ type: type ?? 'message', data, id });
    }
  }
  return events;
}

export function parseSSEData(data: string): unknown | null {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}
