import { injectThemeStyles } from './theme';

const SENTINEL = '你现在具备调用本机工具的能力';
const STYLE_ID = 'dbp-cleanup-css';
const CHIPPED_ATTR = 'data-dbp-chip';
const HIDDEN_ATTR = 'data-dbp-hidden';
const PANEL_ID = 'dbp-inline';

// The column wrapper 豆包 uses for each conversation turn; we also use it as the
// anchor for the agent card panel (see overlay.ts).
const COLUMN_SELECTOR = '[class*="content-max-width"]';
// The user's own (send) message bubble.
const SEND_BUBBLE_SELECTOR = '[class*="send-msg-bubble"]';

/**
 * 豆包 renders our injected machinery verbatim inside the conversation: the
 * tool-protocol preamble lands in the user's bubble, `<tool>` / `<task_complete/>`
 * markers and continuation prompts leak into the assistant/user turns. This makes
 * the chat read like raw JSON/XML rather than a real agent.
 *
 * This module rewrites the visible transcript so users only ever see clean text:
 * it masks the injected machinery (in place, preserving 豆包's native markdown
 * rendering of the real prose/answer) and hides turns that become empty. The
 * structured tool execution is shown separately by the card panel (overlay.ts).
 *
 * It runs defensively (never throws) and only blanks text matching our own
 * injected patterns, so it can never hide genuine user/model content.
 */
export function startDomCleanup(): void {
  let queued = false;
  let styled = false;
  const run = () => {
    queued = false;
    try {
      if (!styled) {
        injectCleanupStyles();
        styled = true;
      }
      transformTranscript();
    } catch {
      /* never let cosmetic cleanup break the page */
    }
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(run);
  };
  const attach = () => {
    if (!document.body) {
      requestAnimationFrame(attach);
      return;
    }
    schedule();
    new MutationObserver(schedule).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
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
      margin: 0 0 6px; padding: 3px 9px;
      font-size: 12px; color: var(--dbp-accent);
      background: var(--dbp-accent-soft);
      border: 1px solid var(--dbp-accent);
      border-radius: 999px;
      cursor: default; user-select: none;
    }
    .dbp-protocol-chip::before { content: '\\1F6E0'; }
    [${HIDDEN_ATTR}] { display: none !important; }
  `;
  // At document_start <head> may not exist yet; <html> always does.
  (document.head ?? document.documentElement).appendChild(style);
}

function transformTranscript(): void {
  const columns = document.querySelectorAll<HTMLElement>(COLUMN_SELECTOR);
  if (!columns.length) return;
  const lastColumn = columns[columns.length - 1] ?? null;

  // Mask machinery in every turn. The latest assistant turn shares its column
  // with the card panel, so we must NOT skip panel-hosting columns here — the
  // TreeWalker (maskMachinery) already excludes the panel's own subtree.
  for (const col of columns) {
    maskMachinery(col);
  }

  // Hide turns that became empty after masking (continuation/nudge user turns
  // and tool-only assistant turns). Skip the latest column: it hosts the card
  // panel and may be transiently empty mid-stream.
  for (const col of columns) {
    if (col === lastColumn) continue;
    if (col.querySelector(`#${PANEL_ID}`)) continue;
    if ((col.textContent ?? '').trim() === '') hideEmptyTurn(col);
  }

  // Add a compact chip to the (now clean) first user task bubble.
  for (const bubble of document.querySelectorAll<HTMLElement>(SEND_BUBBLE_SELECTOR)) {
    const text = (bubble.textContent ?? '').trim();
    if (!text || bubble.hasAttribute(CHIPPED_ATTR)) continue;
    if (bubble.closest(`[${HIDDEN_ATTR}]`)) continue;
    bubble.setAttribute(CHIPPED_ATTR, 'true');
    const chip = document.createElement('div');
    chip.className = 'dbp-protocol-chip';
    chip.title = '豆包 Pilot 已为本条消息注入工具调用能力';
    chip.textContent = '豆包 Pilot';
    bubble.prepend(chip);
  }
}

/** Blanks injected-machinery substrings inside one turn, preserving real text. */
function maskMachinery(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest(`#${PANEL_ID}`)) return NodeFilter.FILTER_REJECT;
      if (parent.closest('textarea')) return NodeFilter.FILTER_REJECT;
      if (parent.classList.contains('dbp-protocol-chip')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const spans: { node: Text; start: number }[] = [];
  let full = '';
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const textNode = current as Text;
    spans.push({ node: textNode, start: full.length });
    full += textNode.nodeValue ?? '';
  }
  // Fast path: bail unless the turn contains one of our injected markers.
  if (
    !full.includes(SENTINEL) &&
    !full.includes('[工具执行结果]') &&
    !full.includes('你似乎还没有完成任务') &&
    !full.includes('<tool') &&
    !full.includes('<task_complete')
  ) {
    return;
  }

  const ranges = computeMaskRanges(full);
  if (!ranges.length) return;

  for (const { node, start } of spans) {
    const value = node.nodeValue ?? '';
    let out = '';
    for (let i = 0; i < value.length; i++) {
      const gi = start + i;
      if (!ranges.some(([a, b]) => gi >= a && gi < b)) out += value[i];
    }
    if (out !== value) node.nodeValue = out;
  }
}

/** Removes all injected-machinery substrings from a turn's text (pure helper). */
export function stripMachinery(full: string): string {
  const ranges = computeMaskRanges(full);
  if (!ranges.length) return full;
  let out = '';
  for (let i = 0; i < full.length; i++) {
    if (!ranges.some(([a, b]) => i >= a && i < b)) out += full[i];
  }
  return out;
}

/** Computes character ranges (in the turn's concatenated text) to blank out. */
export function computeMaskRanges(full: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const pushAll = (re: RegExp) => {
    for (const m of full.matchAll(re)) {
      if (m.index !== undefined) ranges.push([m.index, m.index + m[0].length]);
    }
  };

  // Injected tool-protocol preamble: drop everything up to the real task.
  const preamble = new RegExp(`${SENTINEL}[\\s\\S]*?##\\s*用户任务\\s*\\n?`);
  const pm = full.match(preamble);
  if (pm && pm.index !== undefined) ranges.push([pm.index, pm.index + pm[0].length]);

  // Closed tool-call blocks and the completion marker.
  pushAll(/<tool\b[^>]*>[\s\S]*?<\/tool>/g);
  pushAll(/<task_complete\s*\/?\s*>/g);

  // Continuation prompts and the stall nudge (entire machinery turns).
  pushAll(/\[工具执行结果\][\s\S]*?（原始任务回顾：[\s\S]*?）/g);
  pushAll(/你似乎还没有完成任务[\s\S]*?）/g);

  // Streaming: an unclosed `<tool ...` tail — hide from it to the end of the turn.
  const open = full.lastIndexOf('<tool');
  if (open >= 0 && full.indexOf('</tool>', open) < 0) ranges.push([open, full.length]);

  return ranges;
}

/** Hides the largest empty wrapper around an emptied turn (incl. its avatar). */
function hideEmptyTurn(column: HTMLElement): void {
  let target: HTMLElement = column;
  while (
    target.parentElement &&
    !target.parentElement.className.includes('message-list') &&
    (target.parentElement.textContent ?? '').trim() === '' &&
    !target.parentElement.querySelector(`#${PANEL_ID}`)
  ) {
    target = target.parentElement;
  }
  target.setAttribute(HIDDEN_ATTR, 'true');
}
