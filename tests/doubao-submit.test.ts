import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDoubaoContinuationBody,
  streamDoubaoCompletion,
} from '../src/core/doubao/submit';

const TEMPLATE_BODY = JSON.stringify({
  client_meta: {
    local_conversation_id: 'local_123',
    conversation_id: '',
    bot_id: '7338286299411103781',
    last_section_id: '',
    last_message_index: null,
  },
  messages: [
    {
      local_message_id: 'old-id',
      content_block: [
        { block_type: 10000, content: { text_block: { text: 'original', icon_url: '' } }, block_id: 'b1' },
      ],
      message_status: 0,
    },
  ],
  option: { need_create_conversation: true, create_time_ms: 1, unique_key: 'k1', need_deep_think: 0 },
  ext: { fp: 'verify_x' },
});

function sseResponse(body: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Emit in two pieces, splitting mid-event to exercise buffering.
      const mid = Math.floor(body.length / 2);
      controller.enqueue(new TextEncoder().encode(body.slice(0, mid)));
      controller.enqueue(new TextEncoder().encode(body.slice(mid)));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const STREAM = [
  'event: SSE_ACK\ndata: {"ack_client_meta":{"conversation_id":"C1","section_id":"S1"}}',
  'event: STREAM_MSG_NOTIFY\ndata: {"content":{"content_block":[{"block_type":10000,"content":{"text_block":{"text":"Hello "}}}],"content_type":9999},"meta":{"message_id":"M1"}}',
  'event: CHUNK_DELTA\ndata: {"text":"world"}',
  'event: SSE_REPLY_END\ndata: {"end_type":1,"msg_finish_attr":{"msgid":"M1","brief":"Hello world"}}',
  'event: SSE_REPLY_END\ndata: {"end_type":3}',
].join('\n\n');

describe('豆包 continuation body builder', () => {
  it('rewrites user text and switches to an existing conversation', () => {
    const out = buildDoubaoContinuationBody(TEMPLATE_BODY, {
      promptText: 'tool results here',
      conversationId: 'C1',
      sectionId: 'S1',
    });
    expect(out).not.toBeNull();
    const parsed = JSON.parse(out!);
    expect(parsed.messages[0].content_block[0].content.text_block.text).toBe('tool results here');
    expect(parsed.client_meta.conversation_id).toBe('C1');
    expect(parsed.client_meta.last_section_id).toBe('S1');
    expect(parsed.client_meta.local_conversation_id).toBe('');
    expect(parsed.option.need_create_conversation).toBe(false);
    // Per-turn identifiers are regenerated.
    expect(parsed.messages[0].local_message_id).not.toBe('old-id');
    // Untouched fingerprint fields survive.
    expect(parsed.ext.fp).toBe('verify_x');
  });

  it('returns null for invalid templates', () => {
    expect(buildDoubaoContinuationBody('nope', { promptText: 'x', conversationId: 'C' })).toBeNull();
  });
});

describe('streamDoubaoCompletion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('accumulates assistant text and conversation metadata across split chunks', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => sseResponse(STREAM)));
    const chunks: string[] = [];
    const turn = await streamDoubaoCompletion(
      { url: 'https://www.doubao.com/chat/completion', body: '{}' },
      { onTextChunk: (chunk) => chunks.push(chunk) },
    );
    expect(turn.assistantText).toBe('Hello world');
    expect(chunks.join('')).toBe('Hello world');
    expect(turn.finished).toBe(true);
    expect(turn.conversationId).toBe('C1');
    expect(turn.sectionId).toBe('S1');
    expect(turn.assistantMessageId).toBe('M1');
  });

  it('can stream without retaining full text', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => sseResponse(STREAM)));
    const fullTexts: string[] = [];
    const turn = await streamDoubaoCompletion(
      { url: 'https://www.doubao.com/chat/completion', body: '{}' },
      { retainAssistantText: false, onTextChunk: (_chunk, full) => fullTexts.push(full) },
    );
    expect(turn.assistantText).toBe('');
    expect(fullTexts.every((t) => t === '')).toBe(true);
    expect(turn.finished).toBe(true);
  });

  it('throws on non-OK responses', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response('', { status: 403 })));
    await expect(
      streamDoubaoCompletion({ url: 'https://www.doubao.com/chat/completion', body: '{}' }),
    ).rejects.toThrow(/HTTP 403/);
  });
});
