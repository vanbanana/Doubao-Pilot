import type { AgentEvent } from '../agent/loop';
import type { ToolCall, ToolResult } from '../tools/types';
import { injectThemeStyles } from './theme';
import { renderMarkdown } from './markdown';

const CONTAINER_ID = 'dbp-inline';
const STYLE_ID = 'dbp-agent-panel-css';

// 豆包 renders its messages inside a virtualized list (`message-list-*`) and
// centers each turn in a column constrained by `--content-max-width`. We anchor
// our card block to the latest such column *inside the message list* (scoping it
// this way avoids matching the composer, which uses the same width var), so it
// reads as part of the conversation, and re-mount it whenever 豆包's React /
// virtual list recycles or re-renders the row.
const COLUMN_SELECTOR = '[class*="message-list"] [class*="content-max-width"]';

interface PanelState {
  container: HTMLElement;
  body: HTMLElement;
  status: HTMLElement;
  currentStep: HTMLElement | null;
  toolCards: Map<string, HTMLElement>;
}

let state: PanelState | null = null;
let observer: MutationObserver | null = null;
let remountQueued = false;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function injectStyles(): void {
  injectThemeStyles();
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = PANEL_CSS;
  document.head.appendChild(style);
}

/** The conversation column we should append our block to, or null off-chat. */
function findAnchor(): HTMLElement | null {
  const columns = document.querySelectorAll<HTMLElement>(COLUMN_SELECTOR);
  return columns.length ? columns[columns.length - 1] ?? null : null;
}

/** Places the block inside the latest conversation column (or fixes it bottom-right). */
function mount(container: HTMLElement): void {
  const anchor = findAnchor();
  if (anchor) {
    if (container.parentElement !== anchor) anchor.appendChild(container);
    container.setAttribute('data-floating', 'false');
  } else if (container.parentElement !== document.body) {
    // Fallback when not on a chat page: behave like a floating panel.
    document.body.appendChild(container);
    container.setAttribute('data-floating', 'true');
  }
}

function startObserver(container: HTMLElement): void {
  if (observer) return;
  observer = new MutationObserver(() => {
    if (remountQueued) return;
    remountQueued = true;
    requestAnimationFrame(() => {
      remountQueued = false;
      // Re-anchor if 豆包 detached our block during a re-render/recycle.
      if (!container.isConnected || (findAnchor() && container.parentElement !== findAnchor())) {
        mount(container);
      }
    });
  });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
}

function ensurePanel(): PanelState {
  if (state && state.container.isConnected) return state;
  injectStyles();

  const container = document.createElement('div');
  container.id = CONTAINER_ID;
  container.innerHTML = `
    <div class="dbp-inline-head">
      <span class="dbp-panel-dot"></span>
      <span class="dbp-panel-title">豆包 Pilot · 执行过程</span>
      <span class="dbp-panel-status">就绪</span>
      <button class="dbp-panel-btn dbp-panel-min" title="折叠/展开">－</button>
    </div>
    <div class="dbp-panel-body"></div>
  `;

  const body = container.querySelector<HTMLElement>('.dbp-panel-body')!;
  const status = container.querySelector<HTMLElement>('.dbp-panel-status')!;
  const minBtn = container.querySelector<HTMLElement>('.dbp-panel-min')!;

  minBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const collapsed = container.getAttribute('data-collapsed') === 'true';
    container.setAttribute('data-collapsed', collapsed ? 'false' : 'true');
    minBtn.textContent = collapsed ? '＋' : '－';
  });

  mount(container);
  startObserver(container);

  state = { container, body, status, currentStep: null, toolCards: new Map() };
  return state;
}

function setStatus(text: string, tone?: 'run' | 'done' | 'error'): void {
  const s = ensurePanel();
  s.status.textContent = text;
  s.status.setAttribute('data-tone', tone ?? '');
  s.container.setAttribute('data-running', tone === 'run' ? 'true' : 'false');
}

function createStepCard(stepNumber: number): HTMLElement {
  const step = document.createElement('div');
  step.className = 'dbp-step';
  step.setAttribute('data-status', 'streaming');
  step.innerHTML = `
    <div class="dbp-step-head" role="button" tabindex="0">
      <span class="dbp-step-idx">第 ${stepNumber} 步</span>
      <span class="dbp-step-status">思考中…</span>
      <span class="dbp-chevron"></span>
    </div>
    <div class="dbp-step-prose"></div>
    <div class="dbp-step-tools"></div>
  `;
  const head = step.querySelector<HTMLElement>('.dbp-step-head')!;
  const toggle = () => {
    const collapsed = step.getAttribute('data-collapsed') === 'true';
    step.setAttribute('data-collapsed', collapsed ? 'false' : 'true');
  };
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });
  return step;
}

function setStepStatus(step: HTMLElement, status: string, label: string): void {
  step.setAttribute('data-status', status);
  const el = step.querySelector('.dbp-step-status');
  if (el) el.textContent = label;
}

function createToolCard(call: ToolCall): HTMLElement {
  const card = document.createElement('div');
  card.className = 'dbp-tc';
  card.setAttribute('data-state', 'running');
  const argRows = Object.entries(call.args ?? {});
  const argsHtml = argRows.length
    ? argRows
        .map(
          ([k, v]) =>
            `<div class="dbp-tc-row"><span class="dbp-tc-key">${escapeHtml(k)}</span><span class="dbp-tc-val">${escapeHtml(
              formatValue(v),
            )}</span></div>`,
        )
        .join('')
    : '<div class="dbp-tc-empty">（无参数）</div>';
  card.innerHTML = `
    <div class="dbp-tc-head" role="button" tabindex="0">
      <span class="dbp-tc-ico">${WRENCH_SVG}</span>
      <span class="dbp-tc-name">${escapeHtml(call.name)}</span>
      <span class="dbp-tc-st"><span class="dbp-spin"></span><span class="dbp-tc-st-text">执行中</span></span>
      <span class="dbp-chevron"></span>
    </div>
    <div class="dbp-tc-body">
      <div class="dbp-tc-sec"><div class="dbp-tc-lbl">参数</div><div class="dbp-tc-args">${argsHtml}</div></div>
      <div class="dbp-tc-sec dbp-tc-result-sec" data-hidden="true"><div class="dbp-tc-lbl">结果</div><div class="dbp-tc-result"></div></div>
    </div>
  `;
  const head = card.querySelector<HTMLElement>('.dbp-tc-head')!;
  head.addEventListener('click', () => {
    const collapsed = card.getAttribute('data-collapsed') === 'true';
    card.setAttribute('data-collapsed', collapsed ? 'false' : 'true');
  });
  return card;
}

function setToolResult(card: HTMLElement, result: ToolResult): void {
  card.setAttribute('data-state', result.ok ? 'success' : 'error');
  const spin = card.querySelector('.dbp-spin');
  spin?.remove();
  const stText = card.querySelector('.dbp-tc-st-text');
  if (stText) stText.textContent = result.ok ? '成功' : '失败';
  const summary = (result.error ? `${result.error}: ` : '') + (result.output ?? '');
  const sec = card.querySelector<HTMLElement>('.dbp-tc-result-sec');
  const resEl = card.querySelector<HTMLElement>('.dbp-tc-result');
  if (sec && resEl && summary.trim()) {
    resEl.textContent = summary.slice(0, 1200);
    sec.removeAttribute('data-hidden');
  }
  // Auto-collapse successful tool cards so the panel stays tidy.
  if (result.ok) {
    window.setTimeout(() => {
      if (card.getAttribute('data-collapsed') !== 'true') {
        card.setAttribute('data-collapsed', 'true');
      }
    }, 1800);
  }
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function appendFinalAnswer(body: HTMLElement, text: string): void {
  const answer = document.createElement('div');
  answer.className = 'dbp-answer';
  answer.innerHTML = `<div class="dbp-answer-lbl">最终回答</div><div class="dbp-answer-body">${renderMarkdown(
    text,
  )}</div>`;
  body.appendChild(answer);
}

function appendFooter(body: HTMLElement, text: string, isError: boolean): void {
  const footer = document.createElement('div');
  footer.className = `dbp-footer ${isError ? 'error' : 'complete'}`;
  footer.textContent = text;
  body.appendChild(footer);
}

function scrollIntoView(): void {
  if (!state) return;
  if (state.container.getAttribute('data-floating') === 'true') {
    state.body.scrollTop = state.body.scrollHeight;
  } else {
    state.body.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }
}

export function renderAgentEvent(event: AgentEvent): void {
  const s = ensurePanel();
  s.container.setAttribute('data-collapsed', 'false');

  switch (event.type) {
    case 'step_start': {
      const step = createStepCard(event.step + 1);
      s.body.appendChild(step);
      s.currentStep = step;
      setStatus(`运行中 · 第 ${event.step + 1} 步`, 'run');
      break;
    }
    case 'assistant_text': {
      if (!s.currentStep) break;
      const prose = s.currentStep.querySelector<HTMLElement>('.dbp-step-prose');
      if (prose) prose.innerHTML = renderMarkdown(event.text);
      setStepStatus(s.currentStep, 'streaming', '已回复');
      break;
    }
    case 'tool_start': {
      if (!s.currentStep) break;
      setStepStatus(s.currentStep, 'executing_tools', '调用工具');
      const tools = s.currentStep.querySelector<HTMLElement>('.dbp-step-tools');
      const card = createToolCard(event.call);
      tools?.appendChild(card);
      s.toolCards.set(event.call.id, card);
      break;
    }
    case 'tool_result': {
      const card = s.toolCards.get(event.result.callId);
      if (card) setToolResult(card, event.result);
      break;
    }
    case 'done': {
      if (s.currentStep) setStepStatus(s.currentStep, 'complete', '完成');
      if (event.finalText.trim()) appendFinalAnswer(s.body, event.finalText.trim());
      appendFooter(s.body, `完成 · ${event.steps} 步 / ${event.tools} 次工具调用`, false);
      setStatus('已完成', 'done');
      break;
    }
    case 'stopped': {
      if (s.currentStep) setStepStatus(s.currentStep, 'error', '已停止');
      if (event.finalText.trim()) appendFinalAnswer(s.body, event.finalText.trim());
      const reasonText =
        event.reason === 'budget' ? '已达步数上限' : event.reason === 'aborted' ? '已中止' : '已停止';
      appendFooter(s.body, `停止 · ${reasonText}`, true);
      setStatus(reasonText, 'error');
      break;
    }
    default:
      break;
  }
  scrollIntoView();
}

export function resetOverlay(): void {
  const s = ensurePanel();
  s.body.innerHTML = '';
  s.currentStep = null;
  s.toolCards.clear();
  setStatus('运行中', 'run');
}

const WRENCH_SVG =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';

const PANEL_CSS = `
#${CONTAINER_ID} {
  display: block;
  width: 100%;
  margin: 10px 0 14px;
  background: var(--dbp-surface);
  color: var(--dbp-text);
  border: 1px solid var(--dbp-border);
  border-radius: 14px;
  box-shadow: var(--dbp-shadow);
  font: 13px/1.55 -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Noto Sans SC', 'Segoe UI', sans-serif;
  overflow: hidden;
  animation: dbp-pop 0.18s ease;
  box-sizing: border-box;
}
#${CONTAINER_ID}[data-floating="true"] {
  position: fixed;
  right: 20px;
  bottom: 20px;
  width: 340px;
  max-height: 64vh;
  margin: 0;
  display: flex;
  flex-direction: column;
  z-index: 2147483647;
}
@keyframes dbp-pop { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.dbp-inline-head {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px;
  background: var(--dbp-surface-muted);
  border-bottom: 1px solid var(--dbp-border-muted);
  user-select: none;
}
.dbp-panel-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--dbp-text-subtle);
  flex-shrink: 0;
}
#${CONTAINER_ID}[data-running="true"] .dbp-panel-dot {
  background: var(--dbp-accent);
  box-shadow: 0 0 0 0 var(--dbp-accent-soft);
  animation: dbp-pulse 1.4s ease infinite;
}
@keyframes dbp-pulse { 0% { box-shadow: 0 0 0 0 var(--dbp-accent-soft); } 70% { box-shadow: 0 0 0 6px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
.dbp-panel-title { font-weight: 600; }
.dbp-panel-status {
  margin-left: auto; font-size: 11px; color: var(--dbp-text-muted);
}
.dbp-panel-status[data-tone="done"] { color: var(--dbp-success); }
.dbp-panel-status[data-tone="error"] { color: var(--dbp-error); }
.dbp-panel-status[data-tone="run"] { color: var(--dbp-accent); }
.dbp-panel-btn {
  border: none; background: transparent; color: var(--dbp-text-muted);
  cursor: pointer; font-size: 15px; line-height: 1; padding: 0 2px; margin-left: 6px;
}
.dbp-panel-btn:hover { color: var(--dbp-text); }
.dbp-panel-body {
  padding: 12px 14px;
}
#${CONTAINER_ID}[data-floating="true"] .dbp-panel-body {
  overflow-y: auto; flex: 1; padding: 10px;
}
#${CONTAINER_ID}[data-collapsed="true"] .dbp-panel-body { display: none; }

.dbp-step {
  margin-bottom: 8px;
  border: 1px solid var(--dbp-border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--dbp-surface);
}
.dbp-step[data-status="executing_tools"] { border-color: var(--dbp-warning); }
.dbp-step[data-status="complete"] { border-color: var(--dbp-success); }
.dbp-step[data-status="error"] { border-color: var(--dbp-error); }
.dbp-step-head {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px; cursor: pointer; user-select: none;
  background: var(--dbp-surface-muted);
  font-size: 12px;
}
.dbp-step-idx { font-weight: 600; color: var(--dbp-accent); }
.dbp-step-status { flex: 1; color: var(--dbp-text-muted); }
.dbp-chevron {
  width: 0; height: 0; margin-left: auto;
  border-left: 4px solid transparent; border-right: 4px solid transparent;
  border-top: 5px solid var(--dbp-text-subtle);
  transition: transform 0.2s ease;
}
[data-collapsed="true"] > .dbp-step-head .dbp-chevron,
[data-collapsed="true"] > .dbp-tc-head .dbp-chevron { transform: rotate(-90deg); }
.dbp-step-prose, .dbp-step-tools { transition: max-height 0.25s ease, opacity 0.2s ease; }
.dbp-step[data-collapsed="true"] .dbp-step-prose,
.dbp-step[data-collapsed="true"] .dbp-step-tools { max-height: 0; opacity: 0; overflow: hidden; padding: 0 10px; }
.dbp-step-prose { padding: 8px 10px; color: var(--dbp-text); word-break: break-word; }
.dbp-step-prose:empty { display: none; }
.dbp-step-tools { padding: 0 8px 8px; }
.dbp-step-tools:empty { display: none; }

.dbp-tc {
  margin-top: 6px;
  border: 1px solid var(--dbp-border);
  border-radius: 9px; overflow: hidden;
  background: var(--dbp-surface);
}
.dbp-tc[data-state="success"] { border-color: var(--dbp-success); }
.dbp-tc[data-state="error"] { border-color: var(--dbp-error); }
.dbp-tc-head {
  display: flex; align-items: center; gap: 7px;
  padding: 6px 9px; cursor: pointer; user-select: none;
  background: var(--dbp-surface-muted);
}
.dbp-tc-ico {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border-radius: 6px;
  background: var(--dbp-accent-soft); color: var(--dbp-accent); flex-shrink: 0;
}
.dbp-tc[data-state="success"] .dbp-tc-ico { color: var(--dbp-success); }
.dbp-tc[data-state="error"] .dbp-tc-ico { color: var(--dbp-error); }
.dbp-tc-name {
  font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace;
  font-size: 12px; font-weight: 600; color: var(--dbp-text); flex-shrink: 0;
}
.dbp-tc-st { display: inline-flex; align-items: center; gap: 5px; flex: 1; min-width: 0; font-size: 11px; color: var(--dbp-text-muted); }
.dbp-tc[data-state="success"] .dbp-tc-st-text { color: var(--dbp-success); }
.dbp-tc[data-state="error"] .dbp-tc-st-text { color: var(--dbp-error); }
.dbp-tc-st-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dbp-spin {
  width: 10px; height: 10px; border: 1.5px solid var(--dbp-border);
  border-top-color: var(--dbp-accent); border-radius: 50%;
  animation: dbp-spin 0.8s linear infinite; flex-shrink: 0;
}
@keyframes dbp-spin { to { transform: rotate(360deg); } }
.dbp-tc-body { max-height: 1200px; overflow: hidden; transition: max-height 0.25s ease, opacity 0.2s ease; }
.dbp-tc[data-collapsed="true"] .dbp-tc-body { max-height: 0; opacity: 0; }
.dbp-tc-sec { padding: 8px 10px; }
.dbp-tc-sec + .dbp-tc-sec { border-top: 1px dashed var(--dbp-border-muted); }
.dbp-tc-sec[data-hidden] { display: none; }
.dbp-tc-lbl { font-size: 10px; font-weight: 600; letter-spacing: 0.6px; text-transform: uppercase; color: var(--dbp-text-subtle); margin-bottom: 5px; }
.dbp-tc-args { font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace; font-size: 12px; color: var(--dbp-text); word-break: break-word; }
.dbp-tc-row { display: block; line-height: 1.6; }
.dbp-tc-key { color: var(--dbp-text-muted); }
.dbp-tc-key::after { content: ': '; }
.dbp-tc-empty { color: var(--dbp-text-subtle); font-style: italic; }
.dbp-tc-result { font-size: 12px; color: var(--dbp-text); white-space: pre-wrap; word-break: break-word; max-height: 220px; overflow-y: auto; }

.dbp-answer {
  margin-top: 8px; padding: 10px 11px;
  border: 1px solid var(--dbp-accent); border-radius: 10px;
  background: var(--dbp-accent-panel);
}
.dbp-answer-lbl { font-size: 10px; font-weight: 600; letter-spacing: 0.6px; text-transform: uppercase; color: var(--dbp-accent); margin-bottom: 5px; }
.dbp-answer-body { color: var(--dbp-text); word-break: break-word; }
.dbp-answer-body p { margin: 4px 0; }
.dbp-answer-body code { padding: 1px 4px; border-radius: 4px; background: var(--dbp-code-bg); font-family: 'SF Mono', Monaco, Menlo, monospace; font-size: 0.92em; }
.dbp-answer-body pre { margin: 6px 0; padding: 8px; border-radius: 6px; background: var(--dbp-code-bg); overflow-x: auto; }
.dbp-answer-body a { color: var(--dbp-accent); }

.dbp-footer { margin-top: 6px; padding: 4px 2px; font-size: 12px; color: var(--dbp-text-muted); }
.dbp-footer::before { content: '\\25A0  '; }
.dbp-footer.complete::before { color: var(--dbp-success); }
.dbp-footer.error::before { color: var(--dbp-error); }

.dbp-step-prose p { margin: 4px 0; }
.dbp-step-prose code { padding: 1px 4px; border-radius: 4px; background: var(--dbp-code-bg); font-family: 'SF Mono', Monaco, Menlo, monospace; font-size: 0.92em; }
.dbp-step-prose a { color: var(--dbp-accent); }
.dbp-step-prose ul { margin: 4px 0 4px 18px; }
`;
