// 豆包 Pilot 自检向导 — 一键检测本机助手是否就绪，并给出傻瓜式安装引导。
import type { ShellHostStatus } from '../../src/core/tools/shell';
import './style.css';

type OS = 'mac' | 'windows' | 'linux' | 'unknown';

function detectOS(): OS {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'mac';
  if (ua.includes('win')) return 'windows';
  if (ua.includes('linux') || ua.includes('x11')) return 'linux';
  return 'unknown';
}

const OS_LABEL: Record<OS, string> = {
  mac: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
  unknown: '未知系统',
};

// Installer entry per OS (bundled under host/, exposed via web_accessible_resources).
const INSTALLER: Record<OS, { file: string; how: string }> = {
  mac: { file: 'host/install.command', how: '下载后双击 install.command（首次会提示在终端运行）。' },
  windows: { file: 'host/install.bat', how: '下载后双击 install.bat。' },
  linux: { file: 'host/install.sh', how: '下载后在终端运行：sh install.sh' },
  unknown: { file: 'host/install.sh', how: '下载安装脚本并按系统运行。' },
};

function checkHost(): Promise<ShellHostStatus> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'CHECK_HOST' }, (resp) => {
      if (chrome.runtime.lastError || !resp) {
        resolve({ installed: false, error: chrome.runtime.lastError?.message });
        return;
      }
      resolve(resp as ShellHostStatus);
    });
  });
}

const app = document.getElementById('app')!;

function render(status: ShellHostStatus | 'loading'): void {
  const os = detectOS();
  const installer = INSTALLER[os];
  const ready = status !== 'loading' && status.installed;

  app.innerHTML = `
    <header class="hd">
      <div class="logo">豆</div>
      <div>
        <div class="title">豆包 Pilot</div>
        <div class="sub">让豆包获得浏览器与本机操作能力</div>
      </div>
    </header>

    <section class="card">
      <div class="row">
        <span class="dot ${status === 'loading' ? 'wait' : ready ? 'ok' : 'bad'}"></span>
        <span class="state">${
          status === 'loading' ? '正在检测本地助手…' : ready ? '本地助手已就绪' : '本地助手未安装'
        }</span>
      </div>
      ${
        ready && typeof status !== 'string'
          ? `<div class="meta">${status.platform ?? ''} ${status.arch ?? ''} · v${status.version ?? '?'}</div>`
          : ''
      }
      <button id="recheck" class="btn ghost">重新检测</button>
    </section>

    ${
      ready
        ? `<section class="card good">浏览器控制无需安装即可使用；本机命令（shell）已可用。</section>`
        : `
      <section class="card">
        <div class="step-title">一键安装本机助手（${OS_LABEL[os]}）</div>
        <ol class="steps">
          <li>点击下方按钮下载安装器。</li>
          <li>${installer.how}</li>
          <li>完全退出并重新打开浏览器。</li>
          <li>回到此处点「重新检测」。</li>
        </ol>
        <button id="download" class="btn primary">下载安装器</button>
        <div class="hint">需要本机已安装 Node.js 18+。浏览器控制功能无需安装本机助手即可使用。</div>
      </section>`
    }
  `;

  document.getElementById('recheck')?.addEventListener('click', () => {
    render('loading');
    checkHost().then(render);
  });

  document.getElementById('download')?.addEventListener('click', () => {
    const url = chrome.runtime.getURL(installer.file);
    chrome.downloads
      ? chrome.downloads.download({ url })
      : window.open(url, '_blank');
  });
}

render('loading');
checkHost().then(render);
