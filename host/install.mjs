#!/usr/bin/env node
// 豆包 Pilot 本机助手安装器 (one-click native-host installer).
//
// Writes the native-messaging manifest + a launcher wrapper so Chrome can start
// the host. The extension ID is pinned (see wxt.config.ts `key`) so the user
// never has to look it up — running this with no arguments just works.
//
// Usage:
//   node install.mjs [install|status|uninstall] [--browser chrome] [--extension-id <id>]
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';

export const HOST_NAME = 'com.doubao_pilot.shell';
// Deterministic ID derived from the public `key` pinned in wxt.config.ts.
const DEFAULT_EXTENSION_ID = 'nllcakgmmoebgfchfjbcbkpdbffcodac';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOST_SOURCE = resolve(__dirname, 'doubao-pilot-host.mjs');

const SUPPORTED_BROWSERS = new Set(['chrome', 'chromium', 'edge', 'brave']);
const COMMANDS = new Set(['install', 'status', 'uninstall']);

function parseArgs(argv) {
  const args = { command: 'install', browser: 'chrome', extensionId: DEFAULT_EXTENSION_ID };
  const tokens = [...argv];
  if (tokens[0] && COMMANDS.has(tokens[0])) args.command = tokens.shift();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--browser' && tokens[i + 1]) args.browser = tokens[++i].toLowerCase();
    else if (t === '--extension-id' && tokens[i + 1]) args.extensionId = tokens[++i];
    else if (t === '--help' || t === '-h') {
      printHelp();
      process.exit(0);
    } else throw new Error(`未知参数: ${t}`);
  }
  if (!SUPPORTED_BROWSERS.has(args.browser)) throw new Error(`不支持的浏览器: ${args.browser}`);
  return args;
}

function printHelp() {
  console.log(`豆包 Pilot 本机助手安装器

用法:
  node install.mjs                     安装（默认 Chrome，自动使用内置扩展 ID）
  node install.mjs status              查看安装状态
  node install.mjs uninstall           卸载
  node install.mjs --browser edge      指定浏览器: chrome|chromium|edge|brave
  node install.mjs --extension-id <id> 指定扩展 ID（仅在自行打包改了 ID 时需要）
`);
}

function appDataRoot() {
  const home = homedir();
  if (platform() === 'darwin') return `${home}/Library/Application Support/DoubaoPilot`;
  if (platform() === 'linux') return `${home}/.local/share/doubao-pilot`;
  if (platform() === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || resolve(home, 'AppData', 'Local');
    return resolve(localAppData, 'DoubaoPilot');
  }
  throw new Error(`不支持的平台: ${platform()}`);
}

function hostInstallDir() {
  return resolve(appDataRoot(), 'NativeHost');
}

function manifestDir(browser) {
  const os = platform();
  const home = homedir();
  if (os === 'darwin') {
    const base = `${home}/Library/Application Support`;
    return {
      chrome: `${base}/Google/Chrome/NativeMessagingHosts`,
      chromium: `${base}/Chromium/NativeMessagingHosts`,
      edge: `${base}/Microsoft Edge/NativeMessagingHosts`,
      brave: `${base}/BraveSoftware/Brave-Browser/NativeMessagingHosts`,
    }[browser];
  }
  if (os === 'linux') {
    return {
      chrome: `${home}/.config/google-chrome/NativeMessagingHosts`,
      chromium: `${home}/.config/chromium/NativeMessagingHosts`,
      edge: `${home}/.config/microsoft-edge/NativeMessagingHosts`,
      brave: `${home}/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts`,
    }[browser];
  }
  if (os === 'win32') return resolve(appDataRoot(), 'NativeMessagingHosts');
  throw new Error(`不支持的平台: ${os}`);
}

function manifestPath(browser) {
  return resolve(manifestDir(browser), `${HOST_NAME}.json`);
}

function registryKey(browser) {
  return {
    chrome: `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
    edge: `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`,
    chromium: `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`,
    brave: `HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${HOST_NAME}`,
  }[browser];
}

function copyHostScript() {
  const dir = hostInstallDir();
  mkdirSync(dir, { recursive: true });
  const dest = resolve(dir, 'doubao-pilot-host.mjs');
  copyFileSync(HOST_SOURCE, dest);
  if (platform() !== 'win32') chmodSync(dest, 0o755);
  return dest;
}

function createWrapper(hostPath) {
  const dir = dirname(hostPath);
  const node = process.execPath;
  if (platform() === 'win32') {
    const wrapper = resolve(dir, 'doubao-pilot-host.bat');
    writeFileSync(wrapper, `@echo off\r\n"${node}" "${hostPath}" %*\r\n`);
    return wrapper;
  }
  const wrapper = resolve(dir, 'doubao-pilot-host');
  writeFileSync(wrapper, `#!/bin/sh\nexec "${node}" "${hostPath}" "$@"\n`, { mode: 0o755 });
  return wrapper;
}

function install(args) {
  const hostPath = copyHostScript();
  const wrapper = createWrapper(hostPath);
  const manifest = {
    name: HOST_NAME,
    description: '豆包 Pilot 本机助手 — 通过 Native Messaging 执行本机命令',
    path: wrapper,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${args.extensionId}/`],
  };
  const mPath = manifestPath(args.browser);
  mkdirSync(dirname(mPath), { recursive: true });
  writeFileSync(mPath, JSON.stringify(manifest, null, 2) + '\n');

  if (platform() === 'win32') {
    const key = registryKey(args.browser);
    try {
      execSync(`reg add "${key}" /ve /t REG_SZ /d "${mPath}" /f`, { stdio: 'pipe' });
    } catch {
      console.error('警告: 写注册表失败，可能需要管理员权限。手动执行:');
      console.error(`  reg add "${key}" /ve /t REG_SZ /d "${mPath}" /f`);
    }
  }

  console.log('\n✅ 豆包 Pilot 本机助手安装完成\n');
  console.log(`  浏览器:   ${args.browser}`);
  console.log(`  扩展 ID:  ${args.extensionId}`);
  console.log(`  清单:     ${mPath}`);
  console.log(`  启动器:   ${wrapper}`);
  console.log(`\n请完全退出并重新打开 ${args.browser}，然后在豆包页面里点「检测本地助手」即可。\n`);
}

function status(args) {
  const dir = hostInstallDir();
  const hostPath = resolve(dir, 'doubao-pilot-host.mjs');
  const wrapper = resolve(dir, platform() === 'win32' ? 'doubao-pilot-host.bat' : 'doubao-pilot-host');
  const mPath = manifestPath(args.browser);
  const manifest = existsSync(mPath) ? JSON.parse(readFileSync(mPath, 'utf8')) : null;
  const ready = Boolean(manifest && existsSync(hostPath) && existsSync(wrapper));

  console.log('豆包 Pilot 本机助手状态');
  console.log(`  浏览器:   ${args.browser}`);
  console.log(`  助手脚本: ${existsSync(hostPath) ? '已安装' : '缺失'} (${hostPath})`);
  console.log(`  启动器:   ${existsSync(wrapper) ? '已安装' : '缺失'} (${wrapper})`);
  console.log(`  清单:     ${manifest ? '已安装' : '缺失'} (${mPath})`);
  if (manifest?.allowed_origins) console.log(`  授权扩展: ${manifest.allowed_origins.join(', ')}`);
  console.log(`\n  总体状态: ${ready ? '✅ 就绪' : '❌ 未就绪'}`);
  if (!ready) process.exitCode = 1;
}

function uninstall(args) {
  rmSync(manifestPath(args.browser), { force: true });
  if (platform() === 'win32') {
    try {
      execSync(`reg delete "${registryKey(args.browser)}" /f`, { stdio: 'pipe' });
    } catch {
      /* already gone */
    }
  }
  rmSync(hostInstallDir(), { recursive: true, force: true });
  console.log(`已卸载 ${args.browser} 的豆包 Pilot 本机助手。`);
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.command === 'status') return status(args);
  if (args.command === 'uninstall') return uninstall(args);
  return install(args);
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  try {
    main();
  } catch (err) {
    console.error(`\n安装失败: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
