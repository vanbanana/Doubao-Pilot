import type { ToolCall, ToolResult } from './types';

const DEBUGGER_PROTOCOL = '1.3';

let controlledTabId: number | null = null;
const attachedTabs = new Set<number>();

function ok(call: ToolCall, output: string, data?: unknown): ToolResult {
  return { callId: call.id, name: call.name, ok: true, output, data };
}
function fail(call: ToolCall, output: string, error?: string): ToolResult {
  return { callId: call.id, name: call.name, ok: false, output, error };
}

function debuggerSend<T = unknown>(
  tabId: number,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params ?? {}, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result as T);
    });
  });
}

async function ensureAttached(tabId: number): Promise<void> {
  if (attachedTabs.has(tabId)) return;
  await new Promise<void>((resolve, reject) => {
    chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL, () => {
      const err = chrome.runtime.lastError;
      const message = err?.message ?? '';
      if (err && !/already attached/i.test(message)) reject(new Error(message));
      else resolve();
    });
  });
  attachedTabs.add(tabId);
  await debuggerSend(tabId, 'Page.enable');
  await debuggerSend(tabId, 'Runtime.enable');
}

async function getControlledTab(): Promise<number> {
  if (controlledTabId !== null) {
    try {
      await chrome.tabs.get(controlledTabId);
      return controlledTabId;
    } catch {
      controlledTabId = null;
    }
  }
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  if (tab.id == null) throw new Error('无法创建受控标签页');
  controlledTabId = tab.id;
  return controlledTabId;
}

interface EvalResult<T> {
  result?: { value?: T };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
}

async function evaluate<T>(tabId: number, expression: string): Promise<T> {
  const res = await debuggerSend<EvalResult<T>>(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? '页面脚本执行出错');
  }
  return res.result?.value as T;
}

// Injected into the page to tag interactive elements and return a compact list.
const SNAPSHOT_EXPRESSION = `(() => {
  const sel = 'a,button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]';
  const nodes = Array.from(document.querySelectorAll(sel));
  const out = [];
  let i = 0;
  for (const el of nodes) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const ref = 'e' + (++i);
    el.setAttribute('data-dbp-ref', ref);
    const label = (el.getAttribute('aria-label') || el.value || el.placeholder || el.innerText || '').trim().slice(0, 80);
    out.push({ ref, tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || '', label });
    if (i >= 100) break;
  }
  return out;
})()`;

function escapeForEval(value: string): string {
  return JSON.stringify(value);
}

async function navigate(call: ToolCall, tabId: number): Promise<ToolResult> {
  const url = String(call.args.url ?? '');
  if (!/^https?:\/\//i.test(url)) return fail(call, '需要合法的 http/https 网址');
  await debuggerSend(tabId, 'Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 1200));
  const title = await evaluate<string>(tabId, 'document.title');
  return ok(call, `已打开 ${url}（标题: ${title}）`);
}

async function snapshot(call: ToolCall, tabId: number): Promise<ToolResult> {
  const elements = await evaluate<Array<Record<string, string>>>(tabId, SNAPSHOT_EXPRESSION);
  const lines = elements.map((e) => `[${e.ref}] <${e.tag}${e.type ? ' ' + e.type : ''}> ${e.label}`);
  return ok(call, lines.join('\n') || '（无可交互元素）', elements);
}

async function click(call: ToolCall, tabId: number): Promise<ToolResult> {
  const ref = String(call.args.ref ?? '');
  if (!ref) return fail(call, '缺少 ref 参数');
  const done = await evaluate<boolean>(
    tabId,
    `(() => { const el = document.querySelector('[data-dbp-ref=' + ${escapeForEval(JSON.stringify(ref))} + ']'); if(!el) return false; el.click(); return true; })()`,
  );
  return done ? ok(call, `已点击 ${ref}`) : fail(call, `未找到元素 ${ref}`);
}

async function fill(call: ToolCall, tabId: number): Promise<ToolResult> {
  const ref = String(call.args.ref ?? '');
  const text = String(call.args.text ?? '');
  if (!ref) return fail(call, '缺少 ref 参数');
  const done = await evaluate<boolean>(
    tabId,
    `(() => { const el = document.querySelector('[data-dbp-ref=' + ${escapeForEval(JSON.stringify(ref))} + ']'); if(!el) return false; el.focus(); if('value' in el){ el.value = ${escapeForEval(text)}; el.dispatchEvent(new Event('input',{bubbles:true})); } else { el.textContent = ${escapeForEval(text)}; } return true; })()`,
  );
  return done ? ok(call, `已在 ${ref} 填入文本`) : fail(call, `未找到元素 ${ref}`);
}

async function read(call: ToolCall, tabId: number): Promise<ToolResult> {
  const text = await evaluate<string>(tabId, '(document.body && document.body.innerText || "").slice(0, 4000)');
  return ok(call, text || '（页面无可见文本）');
}

export async function executeBrowserTool(call: ToolCall): Promise<ToolResult> {
  try {
    const tabId = await getControlledTab();
    await ensureAttached(tabId);
    switch (call.name) {
      case 'browser_navigate':
        return await navigate(call, tabId);
      case 'browser_snapshot':
        return await snapshot(call, tabId);
      case 'browser_click':
        return await click(call, tabId);
      case 'browser_fill':
        return await fill(call, tabId);
      case 'browser_read':
        return await read(call, tabId);
      default:
        return fail(call, `未知的浏览器工具: ${call.name}`);
    }
  } catch (err) {
    return fail(call, '浏览器工具执行失败', err instanceof Error ? err.message : String(err));
  }
}

export function releaseControlledTab(): void {
  if (controlledTabId !== null && attachedTabs.has(controlledTabId)) {
    chrome.debugger.detach({ tabId: controlledTabId }, () => void chrome.runtime.lastError);
    attachedTabs.delete(controlledTabId);
  }
}
