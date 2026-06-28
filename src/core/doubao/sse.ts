import {
  DOUBAO_CONTENT_TYPE_RICH,
  DOUBAO_PATCH_OBJECT_CONTENT,
  DOUBAO_TEXT_BLOCK_TYPE,
} from './constants';

/**
 * 豆包 streaming event names (SSE `event:` field). The extension only needs a
 * subset; the rest are ignored.
 */
export type DoubaoEventType =
  | 'SSE_HEARTBEAT'
  | 'SSE_ACK'
  | 'FULL_MSG_NOTIFY'
  | 'STREAM_MSG_NOTIFY'
  | 'STREAM_CHUNK'
  | 'CHUNK_DELTA'
  | 'SSE_REPLY_END'
  | string;

export interface DoubaoStreamMeta {
  conversationId?: string;
  sectionId?: string;
  /** Assistant reply message id (target of STREAM_CHUNK patches). */
  assistantMessageId?: string;
  /** User question message id echoed back by the server. */
  questionMessageId?: string;
  /** Full reply text reported by SSE_REPLY_END (`brief`). */
  brief?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Extracts the main answer text from a single text_block content node, e.g.
 * `{ block_type: 10000, content: { text_block: { text: "..." } } }`.
 */
function extractTextBlockText(block: unknown): string | null {
  if (!isRecord(block)) return null;
  if (
    typeof block.block_type === 'number' &&
    block.block_type !== DOUBAO_TEXT_BLOCK_TYPE
  ) {
    return null;
  }
  const content = block.content;
  if (!isRecord(content)) return null;
  const textBlock = content.text_block;
  if (!isRecord(textBlock)) return null;
  const text = textBlock.text;
  return typeof text === 'string' ? text : null;
}

function extractContentBlockArrayText(blocks: unknown): string | null {
  if (!Array.isArray(blocks)) return null;
  const parts = blocks
    .map((block) => extractTextBlockText(block))
    .filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join('') : null;
}

/**
 * Returns the incremental assistant answer text contained in a parsed 豆包 SSE
 * event, or null when the event carries no answer text. TTS mirrors
 * (patch_object 111) and ext/status patches (patch_object 50) are ignored.
 */
export function extractDoubaoResponseText(
  parsed: unknown,
  eventType?: string,
): string | null {
  if (!isRecord(parsed)) return null;

  // CHUNK_DELTA: lightweight delta, `{ "text": "..." }`.
  if (eventType === 'CHUNK_DELTA' || (parsed.text !== undefined && parsed.patch_op === undefined && parsed.content === undefined)) {
    const text = parsed.text;
    if (typeof text === 'string' && text.length > 0) return text;
  }

  // STREAM_MSG_NOTIFY: first assistant packet, content.content_block[].
  if (isRecord(parsed.content)) {
    const content = parsed.content;
    if (
      content.content_type === undefined ||
      content.content_type === DOUBAO_CONTENT_TYPE_RICH
    ) {
      const text = extractContentBlockArrayText(content.content_block);
      if (text) return text;
    }
  }

  // STREAM_CHUNK: patch_op[] with patch_object discriminator.
  if (Array.isArray(parsed.patch_op)) {
    const parts: string[] = [];
    for (const op of parsed.patch_op) {
      if (!isRecord(op)) continue;
      if (op.patch_object !== DOUBAO_PATCH_OBJECT_CONTENT) continue;
      const patchValue = op.patch_value;
      if (!isRecord(patchValue)) continue;
      const text = extractContentBlockArrayText(patchValue.content_block);
      if (text) parts.push(text);
    }
    if (parts.length > 0) return parts.join('');
  }

  return null;
}

/**
 * True when the parsed event signals that the assistant answer is complete.
 * 豆包 emits SSE_REPLY_END with end_type 1 (this message done), 2 (answer done)
 * or 3 (whole turn done); a STREAM_CHUNK ext patch may also carry is_finish.
 */
export function isDoubaoStreamFinished(
  parsed: unknown,
  eventType?: string,
): boolean {
  if (!isRecord(parsed)) return false;

  if (eventType === 'SSE_REPLY_END') {
    const endType = parsed.end_type;
    // end_type 1 = this assistant message finished (text complete).
    // end_type 3 = whole turn finished. Either means text is done.
    return endType === 1 || endType === 3;
  }

  if (Array.isArray(parsed.patch_op)) {
    for (const op of parsed.patch_op) {
      if (!isRecord(op)) continue;
      const patchValue = op.patch_value;
      if (!isRecord(patchValue)) continue;
      const ext = patchValue.ext;
      if (isRecord(ext) && ext.is_finish === '1') return true;
    }
  }

  return false;
}

/**
 * Pulls conversation/section/message identifiers out of a parsed 豆包 SSE event.
 * Returns only the fields present in this particular event.
 */
export function extractDoubaoStreamMeta(
  parsed: unknown,
  eventType?: string,
): DoubaoStreamMeta {
  const meta: DoubaoStreamMeta = {};
  if (!isRecord(parsed)) return meta;

  if (eventType === 'SSE_ACK' && isRecord(parsed.ack_client_meta)) {
    const ack = parsed.ack_client_meta;
    meta.conversationId = readString(ack.conversation_id);
    meta.sectionId = readString(ack.section_id);
    if (Array.isArray(parsed.query_list) && isRecord(parsed.query_list[0])) {
      meta.questionMessageId = readString(parsed.query_list[0].question_id);
    }
    return meta;
  }

  if (eventType === 'FULL_MSG_NOTIFY' && isRecord(parsed.message)) {
    const message = parsed.message;
    meta.conversationId = readString(message.conversation_id);
    meta.sectionId = readString(message.section_id);
    meta.questionMessageId = readString(message.message_id);
    return meta;
  }

  if (eventType === 'STREAM_MSG_NOTIFY' && isRecord(parsed.meta)) {
    const streamMeta = parsed.meta;
    meta.conversationId = readString(streamMeta.conversation_id);
    meta.sectionId = readString(streamMeta.section_id);
    meta.assistantMessageId = readString(streamMeta.message_id);
    return meta;
  }

  if (eventType === 'SSE_REPLY_END' && isRecord(parsed.msg_finish_attr)) {
    const attr = parsed.msg_finish_attr;
    meta.assistantMessageId = readString(attr.msgid);
    meta.brief = readString(attr.brief);
    return meta;
  }

  return meta;
}
