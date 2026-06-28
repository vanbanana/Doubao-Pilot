import { describe, expect, it } from 'vitest';
import { stripMachinery } from '../src/core/ui/dom-cleanup';

const PROTOCOL = [
  '你现在具备调用本机工具的能力，可以操作浏览器和本机来真正完成任务。',
  '',
  '## 可用工具',
  '- shell_exec: 执行命令',
  '',
  '## 调用格式',
  '<tool name="工具名">',
  '{"参数名": "参数值"}',
  '</tool>',
  '',
  '## 规则',
  '5. 如果任务无需任何工具，直接正常回答即可。',
  '',
  '## 用户任务',
].join('\n');

describe('stripMachinery', () => {
  it('strips the injected protocol preamble, leaving only the real user task', () => {
    const full = `${PROTOCOL}\n查看桌面目录文件`;
    expect(stripMachinery(full)).toBe('查看桌面目录文件');
  });

  it('removes closed tool-call XML but keeps the surrounding prose', () => {
    const full = '我将执行 shell 命令查看桌面内容。<tool name="shell_exec">\n{"command": "ls ~/Desktop"}\n</tool>';
    expect(stripMachinery(full)).toBe('我将执行 shell 命令查看桌面内容。');
  });

  it('removes the task_complete marker', () => {
    expect(stripMachinery('<task_complete/>桌面目录为空。')).toBe('桌面目录为空。');
    expect(stripMachinery('已完成。<task_complete />')).toBe('已完成。');
  });

  it('hides an entire continuation prompt turn', () => {
    const full = '[工具执行结果]\n### 工具 1: shell_exec (成功)\nfoo\n\n请根据以上结果继续。（原始任务回顾：查看桌面）';
    expect(stripMachinery(full).trim()).toBe('');
  });

  it('hides the stall nudge turn', () => {
    const full = '你似乎还没有完成任务，但也没有调用工具或声明完成。请输出一个 <tool> 块。（原始任务：查看桌面）';
    expect(stripMachinery(full).trim()).toBe('');
  });

  it('hides an unclosed tool tail during streaming', () => {
    const full = '正在准备调用工具。<tool name="browser_read">\n{';
    expect(stripMachinery(full)).toBe('正在准备调用工具。');
  });

  it('leaves genuine content untouched', () => {
    const full = '这是一个普通回答，没有任何工具调用。';
    expect(stripMachinery(full)).toBe(full);
  });
});
