import { describe, expect, it } from 'vitest';
import {
  createStreamingToolParser,
  extractToolCalls,
  hasTaskCompleteSignal,
  stripToolSyntax,
} from '../src/core/agent/tool-parser';

describe('tool parser', () => {
  it('extracts tool calls with JSON args', () => {
    const text = '我来导航。\n<tool name="browser_navigate">\n{"url": "https://example.com"}\n</tool>';
    const calls = extractToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe('browser_navigate');
    expect(calls[0]!.args).toEqual({ url: 'https://example.com' });
  });

  it('tolerates malformed JSON by returning empty args', () => {
    const calls = extractToolCalls('<tool name="shell_exec">not json</tool>');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual({});
  });

  it('extracts multiple sequential tool calls', () => {
    const text =
      '<tool name="browser_snapshot">{}</tool> then <tool name="browser_click">{"ref":"e3"}</tool>';
    const calls = extractToolCalls(text);
    expect(calls.map((c) => c.name)).toEqual(['browser_snapshot', 'browser_click']);
  });

  it('detects the task-complete marker', () => {
    expect(hasTaskCompleteSignal('all done <task_complete/>')).toBe(true);
    expect(hasTaskCompleteSignal('still working')).toBe(false);
  });

  it('strips tool syntax leaving prose', () => {
    const text = '正在打开页面。<tool name="browser_navigate">{"url":"x"}</tool> 完成 <task_complete/>';
    expect(stripToolSyntax(text)).toBe('正在打开页面。 完成');
  });

  it('streaming parser only emits a tool call once its closing tag arrives', () => {
    const parser = createStreamingToolParser();
    expect(parser.append('<tool name="browser_read">')).toHaveLength(0);
    expect(parser.hasOpenToolTag()).toBe(true);
    const emitted = parser.append('{}</tool>');
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.name).toBe('browser_read');
    expect(parser.hasOpenToolTag()).toBe(false);
    // No duplicate emission on further appends.
    expect(parser.append(' done')).toHaveLength(0);
  });
});
