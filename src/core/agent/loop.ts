import type { ToolCall, ToolResult } from '../tools/types';
import { buildContinuationPrompt, buildNudgePrompt } from './prompt';
import { extractToolCalls, hasTaskCompleteSignal, stripToolSyntax } from './tool-parser';

export interface AgentStepResult {
  text: string;
  toolCalls: ToolCall[];
  finished: boolean;
}

export interface AgentLoopDeps {
  /** Execute a single tool call and return its result. */
  executeTool: (call: ToolCall) => Promise<ToolResult>;
  /** Submit a continuation prompt to 豆包 and return the parsed model turn. */
  submitContinuation: (prompt: string) => Promise<AgentStepResult>;
  onEvent?: (event: AgentEvent) => void;
  maxSteps?: number;
  maxNudges?: number;
  signal?: AbortSignal;
}

export type AgentEvent =
  | { type: 'step_start'; step: number }
  | { type: 'tool_start'; call: ToolCall }
  | { type: 'tool_result'; result: ToolResult }
  | { type: 'assistant_text'; text: string }
  | { type: 'done'; finalText: string; steps: number; tools: number }
  | { type: 'stopped'; reason: 'budget' | 'aborted' | 'empty'; finalText: string };

const DEFAULT_MAX_STEPS = 16;
const DEFAULT_MAX_NUDGES = 2;

/**
 * Drives the multi-step agent: parse tool calls, execute them, feed results
 * back as a continuation prompt, and repeat until the model signals completion,
 * stops calling tools, or the step budget is exhausted.
 */
export async function runAgentLoop(
  initial: AgentStepResult,
  originalTask: string,
  deps: AgentLoopDeps,
): Promise<string> {
  const maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS;
  const maxNudges = deps.maxNudges ?? DEFAULT_MAX_NUDGES;
  const emit = (event: AgentEvent) => deps.onEvent?.(event);

  let current = initial;
  let totalTools = 0;
  let nudges = 0;
  let finalText = stripToolSyntax(current.text);

  for (let step = 0; step < maxSteps; step++) {
    if (deps.signal?.aborted) {
      emit({ type: 'stopped', reason: 'aborted', finalText });
      return finalText;
    }
    emit({ type: 'step_start', step });

    const prose = stripToolSyntax(current.text);
    if (prose) {
      finalText = prose;
      emit({ type: 'assistant_text', text: prose });
    }

    // Note: SSE stream-end only means "this model turn is complete", NOT that
    // the task is done. Completion is signalled by <task_complete/> or by the
    // model answering in prose without requesting any tool (handled below).
    if (hasTaskCompleteSignal(current.text)) {
      emit({ type: 'done', finalText, steps: step + 1, tools: totalTools });
      return finalText;
    }

    if (current.toolCalls.length === 0) {
      // No tools ever used → the model just answered directly; we're done.
      if (totalTools === 0) {
        emit({ type: 'done', finalText, steps: step + 1, tools: totalTools });
        return finalText;
      }
      if (nudges >= maxNudges) {
        emit({ type: 'stopped', reason: 'budget', finalText });
        return finalText;
      }
      nudges += 1;
      current = await deps.submitContinuation(buildNudgePrompt(originalTask));
      continue;
    }

    nudges = 0;
    const results: ToolResult[] = [];
    for (const call of current.toolCalls) {
      if (deps.signal?.aborted) {
        emit({ type: 'stopped', reason: 'aborted', finalText });
        return finalText;
      }
      emit({ type: 'tool_start', call });
      const result = await deps.executeTool(call);
      totalTools += 1;
      results.push(result);
      emit({ type: 'tool_result', result });
    }

    current = await deps.submitContinuation(buildContinuationPrompt(originalTask, results));
  }

  emit({ type: 'stopped', reason: 'budget', finalText });
  return finalText;
}

/** Parses a raw assistant text blob into a step result (used for the first turn). */
export function toStepResult(text: string, finished: boolean): AgentStepResult {
  return {
    text,
    toolCalls: extractToolCalls(text),
    finished: finished || hasTaskCompleteSignal(text),
  };
}
