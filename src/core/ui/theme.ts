const THEME_STYLE_ID = 'dbp-theme-css';

/**
 * Injects shared design tokens for all 豆包 Pilot injected UI. The palette is a
 * cool-ink scheme that adapts to light/dark; we both honour the OS preference
 * and sniff 豆包's own background luminance so the panel matches the site.
 */
export function injectThemeStyles(): void {
  applyThemeClass();
  if (document.getElementById(THEME_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = THEME_STYLE_ID;
  style.textContent = THEME_CSS;
  document.head.appendChild(style);
}

/** Adds `dbp-theme-dark` / `dbp-theme-light` to <html> based on 豆包's background. */
export function applyThemeClass(): void {
  const root = document.documentElement;
  const dark = detectDark();
  root.classList.toggle('dbp-theme-dark', dark);
  root.classList.toggle('dbp-theme-light', !dark);
}

function detectDark(): boolean {
  try {
    const bg = getComputedStyle(document.body).backgroundColor;
    const rgb = bg.match(/\d+(\.\d+)?/g)?.map(Number);
    if (rgb && rgb.length >= 3) {
      const r = rgb[0] ?? 255;
      const g = rgb[1] ?? 255;
      const b = rgb[2] ?? 255;
      // Perceived luminance; treat near-black backgrounds as dark.
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      return lum < 0.5;
    }
  } catch {
    /* fall through to OS preference */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

const THEME_CSS = `
:root, .dbp-theme-light {
  --dbp-surface:        #ffffff;
  --dbp-surface-muted:  #f5f6f8;
  --dbp-surface-hover:  #eceef2;
  --dbp-text:           #1d2129;
  --dbp-text-muted:     #5b6470;
  --dbp-text-subtle:    #8a93a0;
  --dbp-border:         #e3e6eb;
  --dbp-border-muted:   #eef0f3;
  --dbp-accent:         #4d6bfe;
  --dbp-accent-soft:    rgba(77,107,254,0.10);
  --dbp-accent-panel:   rgba(77,107,254,0.06);
  --dbp-code-bg:        rgba(40,44,52,0.06);
  --dbp-success:        #18a058;
  --dbp-warning:        #d98e04;
  --dbp-error:          #e03e3e;
  --dbp-danger-panel:   rgba(224,62,62,0.08);
  --dbp-shadow:         0 8px 32px rgba(20,24,40,0.16);
}
.dbp-theme-dark {
  --dbp-surface:        #1f2129;
  --dbp-surface-muted:  #262932;
  --dbp-surface-hover:  #2f323d;
  --dbp-text:           #e8eaf0;
  --dbp-text-muted:     #aab1be;
  --dbp-text-subtle:    #79808d;
  --dbp-border:         #353944;
  --dbp-border-muted:   #2c2f39;
  --dbp-accent:         #8aa0ff;
  --dbp-accent-soft:    rgba(138,160,255,0.16);
  --dbp-accent-panel:   rgba(138,160,255,0.12);
  --dbp-code-bg:        rgba(255,255,255,0.08);
  --dbp-success:        #36c47e;
  --dbp-warning:        #e0a93a;
  --dbp-error:          #ff7373;
  --dbp-danger-panel:   rgba(255,115,115,0.16);
  --dbp-shadow:         0 8px 32px rgba(0,0,0,0.5);
}
`;
