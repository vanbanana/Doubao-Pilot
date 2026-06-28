import { DOUBAO_TEXT_BLOCK_TYPE } from './constants';

export interface DoubaoRequestInfo {
  /** Concatenated text of the latest user message's text blocks. */
  userText: string;
  /** True when this request opens a brand new conversation. */
  isFirstMessage: boolean;
  /** Server conversation id when continuing an existing chat. */
  conversationId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Locates the text_block node that should receive injected content inside a
 * parsed 豆包 completion request body. 豆包 sends the user turn as
 * `messages[i].content_block[j].content.text_block.text`; the injection target
 * is the first text block of the last user message.
 */
function findInjectableTextBlock(
  body: Record<string, unknown>,
): { textBlock: Record<string, unknown> } | null {
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) return null;

  // The last entry in `messages` is the user's new turn.
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!isRecord(message)) continue;
    const blocks = message.content_block;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (!isRecord(block)) continue;
      if (
        typeof block.block_type === 'number' &&
        block.block_type !== DOUBAO_TEXT_BLOCK_TYPE
      ) {
        continue;
      }
      const content = block.content;
      if (!isRecord(content)) continue;
      const textBlock = content.text_block;
      if (isRecord(textBlock) && typeof textBlock.text === 'string') {
        return { textBlock };
      }
    }
  }
  return null;
}

function readConversationId(body: Record<string, unknown>): string | null {
  const clientMeta = body.client_meta;
  if (!isRecord(clientMeta)) return null;
  const id = clientMeta.conversation_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function readIsFirstMessage(body: Record<string, unknown>): boolean {
  const option = body.option;
  if (isRecord(option) && typeof option.need_create_conversation === 'boolean') {
    return option.need_create_conversation;
  }
  // Fall back to the conversation id: empty id means a fresh conversation.
  return readConversationId(body) === null;
}

/**
 * Parses a 豆包 completion request body string into the fields the extension
 * needs for prompt augmentation. Returns null when the body is not a valid
 * 豆包 completion payload.
 */
export function parseDoubaoRequestBody(bodyStr: string): DoubaoRequestInfo | null {
  let body: unknown;
  try {
    body = JSON.parse(bodyStr);
  } catch {
    return null;
  }
  if (!isRecord(body)) return null;

  const injectable = findInjectableTextBlock(body);
  if (!injectable) return null;
  const userText = injectable.textBlock.text;
  if (typeof userText !== 'string') return null;

  return {
    userText,
    isFirstMessage: readIsFirstMessage(body),
    conversationId: readConversationId(body),
  };
}

export interface DoubaoAugmentResult {
  body: string;
  userText: string;
}

/**
 * Rewrites a 豆包 completion request body, replacing the latest user message's
 * text with `augmentedText`. Returns null when the body cannot be augmented
 * (not valid JSON / no text block), so callers can fall back to the original.
 */
export function augmentDoubaoRequestBody(
  bodyStr: string,
  buildAugmentedText: (userText: string, info: DoubaoRequestInfo) => string,
): DoubaoAugmentResult | null {
  let body: unknown;
  try {
    body = JSON.parse(bodyStr);
  } catch {
    return null;
  }
  if (!isRecord(body)) return null;

  const injectable = findInjectableTextBlock(body);
  if (!injectable) return null;
  const userText = injectable.textBlock.text;
  if (typeof userText !== 'string' || userText.length === 0) return null;

  const info: DoubaoRequestInfo = {
    userText,
    isFirstMessage: readIsFirstMessage(body),
    conversationId: readConversationId(body),
  };

  const augmented = buildAugmentedText(userText, info);
  injectable.textBlock.text = augmented;

  return { body: JSON.stringify(body), userText };
}
