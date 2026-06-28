import { augmentDoubaoRequestBody, parseDoubaoRequestBody } from '../doubao/adapter';
import { buildDoubaoContinuationBody, streamDoubaoCompletion } from '../doubao/submit';
import { ALL_TOOLS } from '../tools/registry';
import type { ToolCall, ToolResult } from '../tools/types';
import { renderAgentEvent, resetOverlay } from '../ui/overlay';
import {
  CONTENT_SOURCE,
  isMainMessage,
  type MainToContentMsg,
} from './messages';
import { runAgentLoop, toStepResult, type AgentStepResult } from './loop';
import { buildToolProtocolPrompt } from './prompt';
import { RequestPacer } from './humanize';

interface TurnContext {
  completionUrl: string;
  templateBody: string;
  conversationId: string | null;
  sectionId: string | null;
  originalTask: string;
}

let turn: TurnContext | null = null;
let accumulatedText = '';
let loopRunning = false;
// Spaces continuation requests out with human-like cadence to avoid tripping
// 豆包's automation/human-verification heuristics.
const pacer = new RequestPacer();

function post(message: { type: 'AUGMENT_RESULT'; id: string; body: string | null }): void {
  window.postMessage({ source: CONTENT_SOURCE, ...message }, window.location.origin);
}

function handleAugmentRequest(id: string, body: string): void {
  const info = parseDoubaoRequestBody(body);
  if (!info || !info.userText.trim()) {
    post({ type: 'AUGMENT_RESULT', id, body: null });
    return;
  }
  if (turn) turn.originalTask = info.userText;
  const augmented = augmentDoubaoRequestBody(body, (userText) =>
    buildToolProtocolPrompt(userText, ALL_TOOLS),
  );
  post({ type: 'AUGMENT_RESULT', id, body: augmented?.body ?? null });
}

async function executeTool(call: ToolCall): Promise<ToolResult> {
  try {
    const result = (await chrome.runtime.sendMessage({
      type: 'EXECUTE_TOOL',
      call,
    })) as ToolResult | undefined;
    if (result && typeof result === 'object') return result;
    return { callId: call.id, name: call.name, ok: false, output: '工具无响应', error: 'no_response' };
  } catch (err) {
    return {
      callId: call.id,
      name: call.name,
      ok: false,
      output: '工具执行失败',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function submitContinuation(prompt: string): Promise<AgentStepResult> {
  if (!turn || !turn.conversationId) {
    return { text: '', toolCalls: [], finished: true };
  }
  const body = buildDoubaoContinuationBody(turn.templateBody, {
    promptText: prompt,
    conversationId: turn.conversationId,
    sectionId: turn.sectionId,
  });
  if (!body) return { text: '', toolCalls: [], finished: true };

  // Human-like pacing before firing the next completion request.
  await pacer.pace(prompt.length);

  const result = await streamDoubaoCompletion({ url: turn.completionUrl, body });
  if (result.conversationId) turn.conversationId = result.conversationId;
  if (result.sectionId) turn.sectionId = result.sectionId;
  return toStepResult(result.assistantText, result.finished);
}

async function startLoopFromInitialResponse(fullText: string): Promise<void> {
  if (loopRunning || !turn) return;
  const initial = toStepResult(fullText, false);
  // Only engage the agent loop if the model actually requested a tool.
  if (initial.toolCalls.length === 0) return;
  loopRunning = true;
  resetOverlay();
  try {
    await runAgentLoop(initial, turn.originalTask, {
      executeTool,
      submitContinuation,
      onEvent: renderAgentEvent,
    });
  } finally {
    loopRunning = false;
  }
}

function handleMainMessage(msg: MainToContentMsg): void {
  switch (msg.type) {
    case 'TURN_CONTEXT':
      turn = {
        completionUrl: msg.completionUrl,
        templateBody: msg.templateBody,
        conversationId: null,
        sectionId: null,
        originalTask: parseDoubaoRequestBody(msg.templateBody)?.userText ?? '',
      };
      accumulatedText = '';
      break;
    case 'STREAM_META':
      if (turn) {
        if (msg.conversationId) turn.conversationId = msg.conversationId;
        if (msg.sectionId) turn.sectionId = msg.sectionId;
      }
      break;
    case 'ASSISTANT_DELTA':
      accumulatedText += msg.text;
      break;
    case 'RESPONSE_DONE':
      void startLoopFromInitialResponse(msg.fullText || accumulatedText);
      break;
    default:
      break;
  }
}

export function startContentBridge(): void {
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (!isMainMessage(event.data)) return;
    const msg = event.data;
    if (msg.type === 'AUGMENT_REQUEST') {
      handleAugmentRequest(msg.id, msg.body);
      return;
    }
    handleMainMessage(msg);
  });
}
