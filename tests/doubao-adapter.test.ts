import { describe, expect, it } from 'vitest';
import {
  augmentDoubaoRequestBody,
  parseDoubaoRequestBody,
} from '../src/core/doubao/adapter';

function makeBody(text: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    client_meta: {
      local_conversation_id: 'local_1',
      conversation_id: '',
      bot_id: '7338286299411103781',
      ...(overrides.client_meta as object | undefined),
    },
    messages: [
      {
        local_message_id: 'm1',
        content_block: [
          {
            block_type: 10000,
            content: { text_block: { text, icon_url: '', summary: '' } },
            block_id: 'b1',
          },
        ],
        message_status: 0,
      },
    ],
    option: { need_create_conversation: true, ...(overrides.option as object | undefined) },
    ext: {},
  });
}

describe('豆包 request adapter', () => {
  it('extracts user text and first-message state', () => {
    const info = parseDoubaoRequestBody(makeBody('hello world'));
    expect(info).not.toBeNull();
    expect(info!.userText).toBe('hello world');
    expect(info!.isFirstMessage).toBe(true);
    expect(info!.conversationId).toBeNull();
  });

  it('detects continuation requests via conversation_id', () => {
    const body = makeBody('again', {
      client_meta: { conversation_id: '384329' },
      option: { need_create_conversation: false },
    });
    const info = parseDoubaoRequestBody(body);
    expect(info!.isFirstMessage).toBe(false);
    expect(info!.conversationId).toBe('384329');
  });

  it('injects augmented text into the text_block and preserves structure', () => {
    const result = augmentDoubaoRequestBody(makeBody('原始问题'), (userText) => {
      expect(userText).toBe('原始问题');
      return `SYSTEM PROMPT\n\n${userText}`;
    });
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!.body);
    expect(parsed.messages[0].content_block[0].content.text_block.text).toBe(
      'SYSTEM PROMPT\n\n原始问题',
    );
    // Surrounding fields stay intact.
    expect(parsed.messages[0].content_block[0].content.text_block.icon_url).toBe('');
    expect(parsed.option.need_create_conversation).toBe(true);
    expect(result!.userText).toBe('原始问题');
  });

  it('returns null for non-JSON or non-豆包 bodies', () => {
    expect(parseDoubaoRequestBody('not json')).toBeNull();
    expect(parseDoubaoRequestBody(JSON.stringify({ prompt: 'x' }))).toBeNull();
    expect(augmentDoubaoRequestBody('not json', (t) => t)).toBeNull();
  });

  it('skips empty user text', () => {
    expect(augmentDoubaoRequestBody(makeBody(''), (t) => `x${t}`)).toBeNull();
  });
});
