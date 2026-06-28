import { dispatchToolCall } from '../src/core/tools/dispatch';
import { pingShellHost } from '../src/core/tools/shell';
import type { ToolCall } from '../src/core/tools/types';

interface ExecuteToolMessage {
  type: 'EXECUTE_TOOL';
  call: ToolCall;
}

function isExecuteToolMessage(msg: unknown): msg is ExecuteToolMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { type?: unknown }).type === 'EXECUTE_TOOL' &&
    typeof (msg as { call?: unknown }).call === 'object'
  );
}

function isCheckHostMessage(msg: unknown): boolean {
  return typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === 'CHECK_HOST';
}

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (isCheckHostMessage(message)) {
      pingShellHost().then(sendResponse);
      return true;
    }
    if (!isExecuteToolMessage(message)) return undefined;
    dispatchToolCall(message.call)
      .then(sendResponse)
      .catch((err: unknown) =>
        sendResponse({
          callId: message.call.id,
          name: message.call.name,
          ok: false,
          output: '后台执行异常',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    // Keep the message channel open for the async response.
    return true;
  });
});
