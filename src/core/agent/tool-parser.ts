import type { ToolCall } from '../tools/types';

const TOOL_OPEN_RE = /<tool\s+name\s*=\s*"([^"]+)"\s*>/i;
const TASK_COMPLETE_RE = /<task_complete\s*\/?>/i;

let callCounter = 0;
function nextCallId(): string {
  callCounter += 1;
  return `call_${Date.now().toString(36)}_${callCounter}`;
}

/**
 * Extracts every `<tool name="x">{json}</tool>` block from a complete text blob.
 * Malformed JSON bodies are tolerated: the raw inner text is preserved and args
 * fall back to an empty object so the loop can still report a useful error.
 */
export function extractToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const re = /<tool\s+name\s*=\s*"([^"]+)"\s*>([\s\S]*?)<\/tool>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const name = match[1]!.trim();
    const inner = (match[2] ?? '').trim();
    calls.push({
      id: nextCallId(),
      name,
      args: parseArgs(inner),
      raw: match[0]!,
    });
  }
  return calls;
}

function parseArgs(inner: string): Record<string, unknown> {
  if (!inner) return {};
  try {
    const parsed = JSON.parse(inner);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    return {};
  }
}

export function hasTaskCompleteSignal(text: string): boolean {
  return TASK_COMPLETE_RE.test(text);
}

/**
 * Removes tool blocks and the task-complete marker from text so only the
 * model's natural-language prose remains for display.
 */
export function stripToolSyntax(text: string): string {
  return text
    .replace(/<tool\s+name\s*=\s*"[^"]+"\s*>[\s\S]*?<\/tool>/gi, '')
    .replace(TASK_COMPLETE_RE, '')
    .trim();
}

/**
 * Incremental parser for streaming responses. Feed text deltas via `append`;
 * completed tool calls are returned as soon as their closing tag arrives.
 */
export function createStreamingToolParser() {
  let buffer = '';
  const seen = new Set<string>();

  return {
    append(delta: string): ToolCall[] {
      buffer += delta;
      const completed: ToolCall[] = [];
      // Only parse up to the last closing tag to avoid emitting partial blocks.
      for (const call of extractToolCalls(buffer)) {
        if (seen.has(call.raw)) continue;
        seen.add(call.raw);
        completed.push(call);
      }
      return completed;
    },
    hasOpenToolTag(): boolean {
      const lastOpen = buffer.search(TOOL_OPEN_RE);
      if (lastOpen === -1) return false;
      const afterOpen = buffer.slice(lastOpen);
      return !/<\/tool>/i.test(afterOpen);
    },
    getBuffer(): string {
      return buffer;
    },
  };
}
