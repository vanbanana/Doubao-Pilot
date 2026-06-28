import type { ToolDescriptor } from './types';

/**
 * Built-in tool catalog. Each tool is exposed to the model via the protocol
 * prompt and dispatched to its execution domain (browser via CDP, shell via the
 * native messaging host).
 */
export const BROWSER_TOOLS: ToolDescriptor[] = [
  {
    name: 'browser_navigate',
    description: '在当前标签页打开一个网址',
    parameters: [{ name: 'url', type: 'string', required: true, description: '目标网址（含 http/https）' }],
    risk: 'medium',
    domain: 'browser',
  },
  {
    name: 'browser_snapshot',
    description: '获取当前页面的可交互元素快照（带元素引用 ref，用于点击/输入）',
    parameters: [],
    risk: 'low',
    domain: 'browser',
  },
  {
    name: 'browser_click',
    description: '点击页面上的某个元素',
    parameters: [{ name: 'ref', type: 'string', required: true, description: 'snapshot 返回的元素引用' }],
    risk: 'medium',
    domain: 'browser',
  },
  {
    name: 'browser_fill',
    description: '向输入框填写文本',
    parameters: [
      { name: 'ref', type: 'string', required: true, description: 'snapshot 返回的元素引用' },
      { name: 'text', type: 'string', required: true, description: '要填入的文本' },
    ],
    risk: 'medium',
    domain: 'browser',
  },
  {
    name: 'browser_read',
    description: '读取当前页面的可见文本内容',
    parameters: [],
    risk: 'low',
    domain: 'browser',
  },
];

export const SHELL_TOOLS: ToolDescriptor[] = [
  {
    name: 'shell_exec',
    description: '在本机执行一条 shell 命令并返回输出（需已安装本地助手）',
    parameters: [{ name: 'command', type: 'string', required: true, description: '要执行的命令' }],
    risk: 'high',
    domain: 'shell',
  },
];

export const ALL_TOOLS: ToolDescriptor[] = [...BROWSER_TOOLS, ...SHELL_TOOLS];

export function getToolDescriptor(
  name: string,
  catalog: readonly ToolDescriptor[] = ALL_TOOLS,
): ToolDescriptor | null {
  return catalog.find((tool) => tool.name === name) ?? null;
}
