import { isDoubaoCompletionURL } from '../doubao/constants';
import {
  extractDoubaoResponseText,
  extractDoubaoStreamMeta,
  isDoubaoStreamFinished,
} from '../doubao/sse';
import { parseSSEChunk, parseSSEData } from './sse';
import {
  CONTENT_SOURCE,
  MAIN_SOURCE,
  isContentMessage,
  type MainToContentMsg,
} from '../agent/messages';

const AUGMENT_TIMEOUT_MS = 6000;

type PendingAugment = {
  resolve: (body: string | null) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pendingAugments = new Map<string, PendingAugment>();
let installed = false;

function post(message: MainToContentMsg): void {
  window.postMessage(message, window.location.origin);
}

function listenForContentReplies(): void {
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (!isContentMessage(event.data)) return;
    if (event.data.type === 'AUGMENT_RESULT') {
      const pending = pendingAugments.get(event.data.id);
      if (!pending) return;
      pendingAugments.delete(event.data.id);
      clearTimeout(pending.timer);
      pending.resolve(event.data.body);
    }
  });
}

function requestAugmentation(body: string): Promise<string | null> {
  const id = crypto.randomUUID();
  return new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => {
      pendingAugments.delete(id);
      resolve(null);
    }, AUGMENT_TIMEOUT_MS);
    pendingAugments.set(id, { resolve, timer });
    post({ source: MAIN_SOURCE, type: 'AUGMENT_REQUEST', id, body });
  });
}

/**
 * Tees the SSE response: forwards a clone's parsed deltas/meta to the content
 * script while the original stream flows untouched to 豆包's own UI.
 */
function teeResponse(response: Response): void {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  const consume = (block: string) => {
    for (const event of parseSSEChunk(block)) {
      const parsed = parseSSEData(event.data);
      if (parsed === null) continue;
      const meta = extractDoubaoStreamMeta(parsed, event.type);
      if (meta.conversationId || meta.sectionId || meta.assistantMessageId) {
        post({ source: MAIN_SOURCE, type: 'STREAM_META', ...meta });
      }
      const text = extractDoubaoResponseText(parsed, event.type);
      if (text) {
        fullText += text;
        post({ source: MAIN_SOURCE, type: 'ASSISTANT_DELTA', text });
      }
      if (isDoubaoStreamFinished(parsed, event.type)) {
        post({ source: MAIN_SOURCE, type: 'RESPONSE_DONE', fullText });
      }
    }
  };

  const pump = (): void => {
    reader
      .read()
      .then(({ done, value }) => {
        if (done) {
          if (buffer.trim()) consume(buffer);
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        let idx = buffer.indexOf('\n\n');
        while (idx !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (block.trim()) consume(block);
          idx = buffer.indexOf('\n\n');
        }
        pump();
      })
      .catch(() => {
        /* stream aborted; ignore */
      });
  };
  pump();
}

export function installDoubaoFetchHook(): void {
  if (installed) return;
  installed = true;
  listenForContentReplies();

  const originalFetch = window.fetch.bind(window);

  window.fetch = async function (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (!isDoubaoCompletionURL(url) || typeof init?.body !== 'string') {
      return originalFetch(input, init);
    }

    const originalBody = init.body;
    post({ source: MAIN_SOURCE, type: 'TURN_CONTEXT', completionUrl: url, templateBody: originalBody });

    const augmented = await requestAugmentation(originalBody);
    const requestInit: RequestInit = augmented ? { ...init, body: augmented } : init;

    const response = await originalFetch(input, requestInit);
    try {
      teeResponse(response.clone());
    } catch {
      /* clone unsupported; skip teeing */
    }
    return response;
  } as typeof window.fetch;
}

// Re-export for the content side to mirror the source tag.
export { CONTENT_SOURCE };
