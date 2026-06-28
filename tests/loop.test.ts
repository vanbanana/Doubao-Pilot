import { describe, expect, it, vi } from 'vitest';
import { runAgentLoop, toStepResult, type AgentEvent, type AgentStepResult } from '../src/core/agent/loop';
import type { ToolCall, ToolResult } from '../src/core/tools/types';

function okResult(call: ToolCall, output: string): ToolResult {
  return { callId: call.id, name: call.name, ok: true, output };
}

describe('agent loop', () => {
  it('executes tools then finishes when the model signals completion', async () => {
    const events: AgentEvent[] = [];
    const executeTool = vi.fn(async (call: ToolCall) => okResult(call, 'snapshot: [e1] button'));
    // First continuation returns another tool, second signals completion.
    const submitContinuation = vi
      .fn<(prompt: string) => Promise<AgentStepResult>>()
      .mockResolvedValueOnce(toStepResult('点击按钮 <tool name="browser_click">{"ref":"e1"}</tool>', false))
      .mockResolvedValueOnce(toStepResult('完成了 <task_complete/> 最终答案', false));

    const initial = toStepResult('我先看看页面 <tool name="browser_snapshot">{}</tool>', false);
    const finalText = await runAgentLoop(initial, '帮我点击按钮', {
      executeTool,
      submitContinuation,
      onEvent: (e) => events.push(e),
    });

    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(submitContinuation).toHaveBeenCalledTimes(2);
    expect(finalText).toContain('最终答案');
    expect(events.some((e) => e.type === 'done')).toBe(true);
    const toolStarts = events.filter((e) => e.type === 'tool_start');
    expect(toolStarts).toHaveLength(2);
  });

  it('finishes immediately when the first turn has no tools', async () => {
    const submitContinuation = vi.fn<(p: string) => Promise<AgentStepResult>>();
    const finalText = await runAgentLoop(
      toStepResult('这是一个直接回答，没有工具。', false),
      '随便问问',
      { executeTool: vi.fn(), submitContinuation },
    );
    expect(submitContinuation).not.toHaveBeenCalled();
    expect(finalText).toContain('直接回答');
  });

  it('nudges then stops when the model stalls without tools or completion', async () => {
    const submitContinuation = vi
      .fn<(p: string) => Promise<AgentStepResult>>()
      .mockResolvedValue(toStepResult('嗯……', false));
    const events: AgentEvent[] = [];

    await runAgentLoop(toStepResult('做点事 <tool name="browser_read">{}</tool>', false), '任务', {
      executeTool: vi.fn(async (c: ToolCall) => okResult(c, 'page text')),
      submitContinuation,
      onEvent: (e) => events.push(e),
      maxNudges: 1,
    });

    // After the tool, continuation stalls -> 1 nudge -> stop(budget).
    expect(events.at(-1)).toMatchObject({ type: 'stopped', reason: 'budget' });
  });

  it('keeps executing tools across turns even when the SSE stream ends (finished=true)', async () => {
    const events: AgentEvent[] = [];
    const executeTool = vi.fn(async (call: ToolCall) => okResult(call, 'ok'));
    // Each model turn fully ends its SSE stream (finished=true) but is NOT
    // task-complete; the agent must still run the requested tool.
    const submitContinuation = vi
      .fn<(prompt: string) => Promise<AgentStepResult>>()
      .mockResolvedValueOnce(toStepResult('读取页面 <tool name="browser_read">{}</tool>', true))
      .mockResolvedValueOnce(toStepResult('这是答案 <task_complete/>', true));

    const initial = toStepResult('打开网页 <tool name="browser_navigate">{"url":"https://example.com"}</tool>', true);
    await runAgentLoop(initial, '打开并读取网页', {
      executeTool,
      submitContinuation,
      onEvent: (e) => events.push(e),
    });

    // navigate + read both executed despite finished=true on every turn.
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(events.filter((e) => e.type === 'tool_start')).toHaveLength(2);
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  it('respects an abort signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const events: AgentEvent[] = [];
    await runAgentLoop(toStepResult('x <tool name="browser_read">{}</tool>', false), 't', {
      executeTool: vi.fn(),
      submitContinuation: vi.fn(),
      onEvent: (e) => events.push(e),
      signal: controller.signal,
    });
    expect(events.at(-1)).toMatchObject({ type: 'stopped', reason: 'aborted' });
  });
});
