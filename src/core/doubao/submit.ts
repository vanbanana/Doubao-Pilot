import { parseSSEChunk, parseSSEData } from '../interceptor/sse';
import {
  extractDoubaoResponseText,
  extractDoubaoStreamMeta,
  isDoubaoStreamFinished,
  type DoubaoStreamMeta,
} from './sse';

export interface DoubaoTurn {
  assistantText: string;
  finished: boolean;
  conversationId: string | null;
  sectionId: string | null;
  assistantMessageId: string | null;
}

export interface DoubaoStreamHandlers {
  /** Retain the full assistant text on the returned turn (default true). */
  retainAssistantText?: boolean;
  onTextChunk?: (chunk: string, fullText: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Builds a continuation request body for an existing 豆包 conversation by
 * cloning the page's last real completion body and overriding the user text and
 * conversation/section identifiers. Cloning the captured template keeps every
 * device/fingerprint/option field byte-identical to what the site sends, which
 * is far more robust than reconstructing the payload from scratch.
 */
export function buildDoubaoContinuationBody(
  templateBodyStr: string,
  params: { promptText: string; conversationId: string; sectionId?: string | null },
): string | null {
  let body: unknown;
  try {
    body = JSON.parse(templateBodyStr);
  } catch {
    return null;
  }
  if (!isRecord(body)) return null;

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) return null;

  // Replace the user text in the last message's first text block.
  const lastMessage = messages[messages.length - 1];
  if (!isRecord(lastMessage) || !Array.isArray(lastMessage.content_block)) return null;
  let replaced = false;
  for (const block of lastMessage.content_block) {
    if (!isRecord(block)) continue;
    const content = block.content;
    if (!isRecord(content)) continue;
    const textBlock = content.text_block;
    if (isRecord(textBlock) && typeof textBlock.text === 'string') {
      textBlock.text = params.promptText;
      replaced = true;
      break;
    }
  }
  if (!replaced) return null;

  // Fresh per-message identifiers so the server treats this as a new turn.
  lastMessage.local_message_id = crypto.randomUUID();

  // Point the request at the existing conversation instead of creating one.
  if (isRecord(body.client_meta)) {
    body.client_meta.conversation_id = params.conversationId;
    body.client_meta.local_conversation_id = '';
    if (params.sectionId) body.client_meta.last_section_id = params.sectionId;
  }
  if (isRecord(body.option)) {
    body.option.need_create_conversation = false;
    body.option.create_time_ms = Date.now();
    body.option.unique_key = crypto.randomUUID();
  }

  return JSON.stringify(body);
}

/**
 * POSTs a completion request to 豆包 and streams the SSE response, accumulating
 * the assistant answer text and conversation identifiers. Mirrors the shape of
 * DeepSeek's `submitPromptStreaming` so the agent loop can treat both sites
 * uniformly.
 */
export async function streamDoubaoCompletion(
  request: { url: string; body: string; headers?: Record<string, string> },
  handlers: DoubaoStreamHandlers = {},
  signal?: AbortSignal,
): Promise<DoubaoTurn> {
  const retainAssistantText = handlers.retainAssistantText !== false;
  const response = await fetch(request.url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'agw-js-conv': 'str', ...request.headers },
    body: request.body,
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`豆包 completion request failed: HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let assistantText = '';
  const turn: DoubaoTurn = {
    assistantText: '',
    finished: false,
    conversationId: null,
    sectionId: null,
    assistantMessageId: null,
  };

  const applyMeta = (meta: DoubaoStreamMeta) => {
    if (meta.conversationId) turn.conversationId = meta.conversationId;
    if (meta.sectionId) turn.sectionId = meta.sectionId;
    if (meta.assistantMessageId) turn.assistantMessageId = meta.assistantMessageId;
  };

  const consumeBlock = (block: string) => {
    const events = parseSSEChunk(block);
    for (const event of events) {
      const parsed = parseSSEData(event.data);
      if (parsed === null) continue;
      applyMeta(extractDoubaoStreamMeta(parsed, event.type));
      const text = extractDoubaoResponseText(parsed, event.type);
      if (text) {
        if (retainAssistantText) assistantText += text;
        handlers.onTextChunk?.(text, retainAssistantText ? assistantText : '');
      }
      if (isDoubaoStreamFinished(parsed, event.type)) {
        turn.finished = true;
      }
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separatorIndex = buffer.indexOf('\n\n');
    while (separatorIndex !== -1) {
      const block = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      if (block.trim()) consumeBlock(block);
      separatorIndex = buffer.indexOf('\n\n');
    }
  }
  if (buffer.trim()) consumeBlock(buffer);

  turn.assistantText = retainAssistantText ? assistantText : '';
  return turn;
}
