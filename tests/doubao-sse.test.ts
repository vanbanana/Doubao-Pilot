import { describe, expect, it } from 'vitest';
import { parseSSEChunk, parseSSEData } from '../src/core/interceptor/sse';
import {
  extractDoubaoResponseText,
  extractDoubaoStreamMeta,
  isDoubaoStreamFinished,
} from '../src/core/doubao/sse';

// Real captured 豆包 SSE stream (trimmed) for "count one to three".
const SAMPLE_STREAM = [
  'id: 0\nevent: SSE_HEARTBEAT\ndata: {}',
  'id: 0\nevent: SSE_ACK\ndata: {"query_list":[{"question_id":"487","local_message_id":"abc","message_index":6}],"ack_client_meta":{"conversation_id":"384329","conversation_type":3,"section_id":"384330"}}',
  'id: 1\nevent: FULL_MSG_NOTIFY\ndata: {"message":{"conversation_id":"384329","message_id":"487","section_id":"384330","content_block":[{"block_type":10000,"content":{"text_block":{"text":"count one to three"}}}]}}',
  'id: 4\nevent: STREAM_MSG_NOTIFY\ndata: {"content":{"content_block":[{"block_type":10000,"content":{"text_block":{"text":"One"}}}],"content_type":9999,"tts_content":"One"},"meta":{"message_id":"999","conversation_id":"384329","section_id":"384330"}}',
  'id: 6\nevent: STREAM_CHUNK\ndata: {"message_id":"999","patch_op":[{"patch_object":1,"patch_type":1,"patch_value":{"content_block":[{"block_type":10000,"content":{"text_block":{"text":","}}}]}}]}',
  'id: 7\nevent: STREAM_CHUNK\ndata: {"message_id":"999","patch_op":[{"patch_object":111,"patch_type":1,"patch_value":{"tts_content":","}}]}',
  'id: 9\nevent: CHUNK_DELTA\ndata: {"text":" two, three"}',
  'id: 13\nevent: STREAM_CHUNK\ndata: {"message_id":"999","patch_op":[{"patch_object":1,"patch_type":1,"patch_value":{"content_block":[{"block_type":10000,"content":{"text_block":{}},"is_finish":true}]}}]}',
  'id: 17\nevent: SSE_REPLY_END\ndata: {"end_type":1,"msg_finish_attr":{"msgid":"999","brief":"One, two, three"}}',
  'id: 25\nevent: SSE_REPLY_END\ndata: {"end_type":3}',
].join('\n\n');

function collect(stream: string): { text: string; finished: boolean } {
  const events = parseSSEChunk(stream);
  let text = '';
  let finished = false;
  for (const event of events) {
    const parsed = parseSSEData(event.data);
    if (!parsed) continue;
    const part = extractDoubaoResponseText(parsed, event.type);
    if (part) text += part;
    if (isDoubaoStreamFinished(parsed, event.type)) finished = true;
  }
  return { text, finished };
}

describe('豆包 SSE parsing', () => {
  it('accumulates assistant text across MSG_NOTIFY / STREAM_CHUNK / CHUNK_DELTA', () => {
    const { text } = collect(SAMPLE_STREAM);
    expect(text).toBe('One, two, three');
  });

  it('ignores tts mirror patches (patch_object 111)', () => {
    const parsed = {
      message_id: '999',
      patch_op: [{ patch_object: 111, patch_type: 1, patch_value: { tts_content: 'hi' } }],
    };
    expect(extractDoubaoResponseText(parsed, 'STREAM_CHUNK')).toBeNull();
  });

  it('ignores ext / suggestion patches (patch_object 50)', () => {
    const parsed = {
      message_id: '999',
      patch_op: [{ patch_object: 50, patch_type: 1, patch_value: { ext: { has_suggest: '1' } } }],
    };
    expect(extractDoubaoResponseText(parsed, 'STREAM_CHUNK')).toBeNull();
  });

  it('detects stream completion on SSE_REPLY_END', () => {
    const { finished } = collect(SAMPLE_STREAM);
    expect(finished).toBe(true);
  });

  it('detects completion via ext.is_finish patch', () => {
    const parsed = {
      patch_op: [{ patch_object: 50, patch_type: 1, patch_value: { ext: { is_finish: '1' } } }],
    };
    expect(isDoubaoStreamFinished(parsed, 'STREAM_CHUNK')).toBe(true);
  });

  it('does not mark heartbeat / ack as finished', () => {
    expect(isDoubaoStreamFinished({}, 'SSE_HEARTBEAT')).toBe(false);
    expect(isDoubaoStreamFinished({ end_type: 2 }, 'SSE_REPLY_END')).toBe(false);
  });

  it('extracts conversation and message identifiers', () => {
    const events = parseSSEChunk(SAMPLE_STREAM);
    const merged: Record<string, string | undefined> = {};
    for (const event of events) {
      const parsed = parseSSEData(event.data);
      if (!parsed) continue;
      Object.assign(merged, extractDoubaoStreamMeta(parsed, event.type));
    }
    expect(merged.conversationId).toBe('384329');
    expect(merged.sectionId).toBe('384330');
    expect(merged.assistantMessageId).toBe('999');
    expect(merged.brief).toBe('One, two, three');
  });
});
