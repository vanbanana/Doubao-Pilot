export const DOUBAO_ORIGIN = 'https://www.doubao.com';

export const DOUBAO_COMPLETION_PATH = '/chat/completion';

export const DOUBAO_COMPLETION_URL = `${DOUBAO_ORIGIN}${DOUBAO_COMPLETION_PATH}`;

/** Default 豆包 bot id observed on the public web client. */
export const DOUBAO_DEFAULT_BOT_ID = '7338286299411103781';

/** content_block.block_type for a plain text block. */
export const DOUBAO_TEXT_BLOCK_TYPE = 10000;

/** content.content_type marker used by 豆包 streaming messages. */
export const DOUBAO_CONTENT_TYPE_RICH = 9999;

/** patch_op.patch_object discriminators inside STREAM_CHUNK events. */
export const DOUBAO_PATCH_OBJECT_CONTENT = 1; // main answer text
export const DOUBAO_PATCH_OBJECT_TTS = 111; // text-to-speech mirror (ignore)
export const DOUBAO_PATCH_OBJECT_EXT = 50; // ext / status / suggestions (ignore for text)

export function isDoubaoHost(hostname: string): boolean {
  return hostname === 'www.doubao.com' || hostname === 'doubao.com';
}

export function isDoubaoCompletionURL(url: string): boolean {
  return url.includes(DOUBAO_COMPLETION_PATH);
}
