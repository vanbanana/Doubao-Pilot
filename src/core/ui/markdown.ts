const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * Minimal, safe inline-markdown renderer for agent output: headings, bold,
 * italic, inline/blocks of code, lists, links and tables. All input is escaped
 * first, so the result is safe to assign to innerHTML.
 */
export function renderMarkdown(text: string): string {
  try {
    const codeBlocks: string[] = [];
    let html = escapeHtml(text);

    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code: string) => {
      const token = `@@DBP_CODE_${codeBlocks.length}@@`;
      codeBlocks.push(`<pre><code>${code}</code></pre>`);
      return token;
    });
    html = renderTables(html);
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, href: string) => {
      const decoded = decodeBasicEntities(href.trim());
      if (!isSafeHref(decoded)) return `${label} (${href})`;
      return `<a href="${escapeAttribute(decoded)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, (m) => (m.includes('<ul>') ? m : `<ul>${m}</ul>`));
    html = html.replace(/<\/ul>\s*<ul>/g, '');
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/<br>(<(?:h[234]|ul|li|pre|table)[^>]*>)/g, '$1');
    html = html.replace(/(<\/(?:h[234]|ul|li|pre|table)>)<br>/g, '$1');
    html = html.replace(/@@DBP_CODE_(\d+)@@/g, (_m, i: string) => codeBlocks[Number(i)] ?? '');
    return html;
  } catch {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }
}

function renderTables(html: string): string {
  const lines = html.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const header = parseRow(line);
    const sep = parseRow(lines[i + 1] ?? '');
    if (!header || !sep || !sep.every(isSepCell)) {
      out.push(line);
      continue;
    }
    const rows: string[][] = [];
    i += 2;
    while (i < lines.length) {
      const row = parseRow(lines[i] ?? '');
      if (!row) break;
      rows.push(normalizeRow(row, header.length));
      i++;
    }
    i--;
    const thead = `<thead><tr>${header.map((c) => `<th>${c}</th>`).join('')}</tr></thead>`;
    const tbody = rows.length
      ? `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>`
      : '';
    out.push(`<table>${thead}${tbody}</table>`);
  }
  return out.join('\n');
}

function parseRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return null;
  const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  return cells.length >= 2 && cells.some((c) => c.length > 0) ? cells : null;
}

function isSepCell(cell: string): boolean {
  return /^:?-{3,}:?$/.test(cell.trim());
}

function normalizeRow(row: string[], width: number): string[] {
  if (row.length === width) return row;
  if (row.length > width) return row.slice(0, width);
  return [...row, ...Array.from({ length: width - row.length }, () => '')];
}

function isSafeHref(value: string): boolean {
  try {
    return SAFE_LINK_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}
