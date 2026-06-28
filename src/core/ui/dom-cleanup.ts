import { injectThemeStyles } from './theme';

const SENTINEL = '你现在具备调用本机工具的能力';
const TASK_MARKER = '## 用户任务';
const PROCESSED_ATTR = 'data-dbp-cleaned';
const STYLE_ID = 'dbp-cleanup-css';

/**
 * 豆包 renders our injected tool-protocol text verbatim inside the user's own
 * message bubble, which is long and noisy. This collapses that block into a
 * compact chip that only shows the real task, so the chat stays clean. It runs
 * defensively (never throws) and only touches our own injected text.
 */
export function startDomCleanup(): void {
  injectCleanupStyles();
  const run = () => {
    try {
      cleanInjectedPrompts();
    } catch {
      /* never let cosmetic cleanup break the page */
    }
  };
  run();
  const observer = new MutationObserver(() => run());
  const attach = () => {
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
      run();
    } else {
      requestAnimationFrame(attach);
    }
  };
  attach();
}

function injectCleanupStyles(): void {
  injectThemeStyles();
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .dbp-protocol-chip {
      display: inline-flex; align-items: center; gap: 6px;
      margin: 2px 0; padding: 3px 9px;
      font-size: 12px; color: var(--dbp-accent);
      background: var(--dbp-accent-soft);
      border: 1px solid var(--dbp-accent);
      border-radius: 999px;
      cursor: default; user-select: none;
    }
    .dbp-protocol-chip::before { content: '\\1F6E0'; }
  `;
  document.head.appendChild(style);
}

function cleanInjectedPrompts(): void {
  // Find the smallest elements whose text is exactly our injected protocol.
  const candidates = document.querySelectorAll<HTMLElement>(`div:not([${PROCESSED_ATTR}])`);
  for (const el of candidates) {
    const text = el.textContent ?? '';
    if (!text.includes(SENTINEL) || !text.includes(TASK_MARKER)) continue;
    // Only act on the tightest container (no child also matches) to avoid
    // hiding the whole conversation.
    const childMatches = Array.from(el.children).some(
      (c) => (c.textContent ?? '').includes(SENTINEL),
    );
    if (childMatches) continue;

    el.setAttribute(PROCESSED_ATTR, 'true');
    const task = extractTask(text);
    const chip = document.createElement('div');
    chip.className = 'dbp-protocol-chip';
    chip.title = '豆包 Pilot 已为本条消息注入工具调用能力';
    chip.textContent = task ? `豆包 Pilot · ${task}` : '豆包 Pilot 已注入工具能力';

    // Hide the original noisy nodes, show the chip in their place.
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        (child as Text).textContent = '';
      } else if (child instanceof HTMLElement) {
        child.style.display = 'none';
      }
    }
    el.prepend(chip);
  }
}

function extractTask(text: string): string {
  const idx = text.indexOf(TASK_MARKER);
  if (idx < 0) return '';
  const task = text.slice(idx + TASK_MARKER.length).trim();
  return task.length > 80 ? `${task.slice(0, 80)}…` : task;
}
