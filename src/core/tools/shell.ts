import type { ToolCall, ToolResult } from './types';

/** Native messaging host id — must match the installed local helper's manifest. */
export const SHELL_HOST_NAME = 'com.doubao_pilot.shell';

const SHELL_TIMEOUT_MS = 60000;
const PING_TIMEOUT_MS = 4000;

export interface ShellHostStatus {
  installed: boolean;
  platform?: string;
  arch?: string;
  version?: string;
  error?: string;
}

/**
 * Probes the local native-messaging host with a `ping` so the self-check wizard
 * can tell the user whether the one-click install succeeded. Resolves with
 * `installed: false` (never rejects) when the host is absent.
 */
export function pingShellHost(): Promise<ShellHostStatus> {
  return new Promise<ShellHostStatus>((resolve) => {
    let settled = false;
    const finish = (status: ShellHostStatus, port?: chrome.runtime.Port) => {
      if (settled) return;
      settled = true;
      try {
        port?.disconnect();
      } catch {
        /* already disconnected */
      }
      resolve(status);
    };

    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connectNative(SHELL_HOST_NAME);
    } catch (err) {
      resolve({ installed: false, error: err instanceof Error ? err.message : String(err) });
      return;
    }

    const timer = setTimeout(() => finish({ installed: false, error: 'timeout' }, port), PING_TIMEOUT_MS);

    port.onMessage.addListener((raw) => {
      clearTimeout(timer);
      const msg = raw as { ok?: boolean; platform?: string; arch?: string; version?: string };
      finish(
        {
          installed: msg.ok !== false,
          platform: msg.platform,
          arch: msg.arch,
          version: msg.version,
        },
        port,
      );
    });

    port.onDisconnect.addListener(() => {
      clearTimeout(timer);
      const err = chrome.runtime.lastError;
      finish({ installed: false, error: err?.message ?? 'native_host_disconnected' });
    });

    port.postMessage({ type: 'ping' });
  });
}

interface ShellHostResponse {
  ok?: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: string;
}

/**
 * Executes a shell command through the locally-installed native messaging host.
 * If the helper is not installed, returns a friendly, actionable error rather
 * than throwing, so the agent can report a clear next step to the user.
 */
export function executeShellTool(call: ToolCall): Promise<ToolResult> {
  const command = String(call.args.command ?? '').trim();
  if (!command) {
    return Promise.resolve({ callId: call.id, name: call.name, ok: false, output: '缺少 command 参数' });
  }

  return new Promise<ToolResult>((resolve) => {
    let settled = false;
    const finish = (result: ToolResult) => {
      if (settled) return;
      settled = true;
      try {
        port.disconnect();
      } catch {
        /* already disconnected */
      }
      resolve(result);
    };

    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connectNative(SHELL_HOST_NAME);
    } catch (err) {
      resolve({
        callId: call.id,
        name: call.name,
        ok: false,
        output: '未检测到本地助手，无法执行本机命令。请先安装「豆包 Pilot 本地助手」。',
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const timer = setTimeout(() => {
      finish({ callId: call.id, name: call.name, ok: false, output: '命令执行超时', error: 'timeout' });
    }, SHELL_TIMEOUT_MS);

    port.onMessage.addListener((raw) => {
      clearTimeout(timer);
      const msg = raw as ShellHostResponse;
      const success = msg.ok !== false && !msg.error && (msg.exitCode ?? 0) === 0;
      const parts = [msg.stdout, msg.stderr].filter(Boolean).join('\n').trim();
      finish({
        callId: call.id,
        name: call.name,
        ok: success,
        output: parts || (success ? '（无输出）' : msg.error || '命令执行失败'),
        error: success ? undefined : msg.error,
        data: { exitCode: msg.exitCode ?? null },
      });
    });

    port.onDisconnect.addListener(() => {
      clearTimeout(timer);
      const err = chrome.runtime.lastError;
      finish({
        callId: call.id,
        name: call.name,
        ok: false,
        output: '未检测到本地助手，无法执行本机命令。请先安装「豆包 Pilot 本地助手」。',
        error: err?.message ?? 'native_host_disconnected',
      });
    });

    port.postMessage({ type: 'exec', command });
  });
}
