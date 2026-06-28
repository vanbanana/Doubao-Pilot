// postMessage bridge between the MAIN-world fetch hook and the ISOLATED-world
// content script. Both run in the same page/origin.

export const MAIN_SOURCE = 'dbp-main';
export const CONTENT_SOURCE = 'dbp-content';

export interface AugmentRequestMsg {
  source: typeof MAIN_SOURCE;
  type: 'AUGMENT_REQUEST';
  id: string;
  body: string;
}

export interface AugmentResultMsg {
  source: typeof CONTENT_SOURCE;
  type: 'AUGMENT_RESULT';
  id: string;
  body: string | null;
}

/** Conversation identifiers + request template captured from the live request. */
export interface TurnContextMsg {
  source: typeof MAIN_SOURCE;
  type: 'TURN_CONTEXT';
  completionUrl: string;
  templateBody: string;
}

export interface AssistantDeltaMsg {
  source: typeof MAIN_SOURCE;
  type: 'ASSISTANT_DELTA';
  text: string;
}

export interface StreamMetaMsg {
  source: typeof MAIN_SOURCE;
  type: 'STREAM_META';
  conversationId?: string;
  sectionId?: string;
  assistantMessageId?: string;
}

export interface ResponseDoneMsg {
  source: typeof MAIN_SOURCE;
  type: 'RESPONSE_DONE';
  fullText: string;
}

export type MainToContentMsg =
  | AugmentRequestMsg
  | TurnContextMsg
  | AssistantDeltaMsg
  | StreamMetaMsg
  | ResponseDoneMsg;

export type ContentToMainMsg = AugmentResultMsg;

export function isMainMessage(data: unknown): data is MainToContentMsg {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: unknown }).source === MAIN_SOURCE
  );
}

export function isContentMessage(data: unknown): data is ContentToMainMsg {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: unknown }).source === CONTENT_SOURCE
  );
}
