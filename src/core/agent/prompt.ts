import type { ToolDescriptor, ToolResult } from '../tools/types';

function renderToolCatalog(tools: readonly ToolDescriptor[]): string {
  return tools
    .map((tool) => {
      const params = tool.parameters.length
        ? tool.parameters
            .map((p) => `    - ${p.name} (${p.type}${p.required ? ', 必填' : ', 可选'}): ${p.description}`)
            .join('\n')
        : '    - 无参数';
      return `- ${tool.name}: ${tool.description}\n${params}`;
    })
    .join('\n');
}

/**
 * Builds the tool-protocol instructions injected ahead of the user's message on
 * the first turn. The model is told to emit `<tool>` blocks; the extension
 * intercepts them, executes the tools, and feeds results back.
 */
export function buildToolProtocolPrompt(
  userText: string,
  tools: readonly ToolDescriptor[],
): string {
  return [
    '你现在具备调用本机工具的能力，可以操作浏览器和本机来真正完成任务，而不仅仅是给出文字建议。',
    '',
    '## 可用工具',
    renderToolCatalog(tools),
    '',
    '## 调用格式',
    '当你需要执行操作时，输出如下 XML 块（参数为 JSON）：',
    '<tool name="工具名">',
    '{"参数名": "参数值"}',
    '</tool>',
    '',
    '## 规则',
    '1. 每次只调用一个工具，等待我把执行结果返回给你后再决定下一步。',
    '2. 调用工具前用一句话说明你要做什么、为什么。',
    '3. 需要先了解页面时，先用 browser_snapshot 或 browser_read 获取上下文，再操作。',
    '4. 任务全部完成后，输出 <task_complete/> 并给出最终回答，不要再调用工具。',
    '5. 如果任务无需任何工具，直接正常回答即可。',
    '',
    '## 用户任务',
    userText,
  ].join('\n');
}

function renderToolResult(result: ToolResult, index: number): string {
  const status = result.ok ? '成功' : '失败';
  const body = result.ok ? result.output : `${result.output}${result.error ? `\n错误: ${result.error}` : ''}`;
  return `### 工具 ${index + 1}: ${result.name} (${status})\n${body}`;
}

/**
 * Builds the continuation prompt sent after tool execution. It re-states the
 * original task and appends the tool results so the model can decide the next
 * step within the same conversation.
 */
export function buildContinuationPrompt(
  originalTask: string,
  results: readonly ToolResult[],
): string {
  return [
    '[工具执行结果]',
    ...results.map(renderToolResult),
    '',
    '请根据以上结果继续。如果还需要操作，继续输出 <tool> 块（一次一个）；',
    '如果任务已完成，输出 <task_complete/> 并给出最终回答。',
    '',
    `（原始任务回顾：${originalTask}）`,
  ].join('\n');
}

/**
 * Light nudge used when the model stops emitting tools without signalling
 * completion, to keep the agent from stalling mid-task.
 */
export function buildNudgePrompt(originalTask: string): string {
  return [
    '你似乎还没有完成任务，但也没有调用工具或声明完成。',
    '如果还需要操作，请输出一个 <tool> 块；如果确实完成了，请输出 <task_complete/> 并给出最终回答。',
    `（原始任务：${originalTask}）`,
  ].join('\n');
}
