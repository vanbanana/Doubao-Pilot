#!/usr/bin/env node
// 豆包 Pilot 本机助手 (native messaging host).
//
// Speaks Chrome's native-messaging wire format (4-byte little-endian length
// prefix + UTF-8 JSON) and implements the small request protocol the extension's
// shell tool expects:
//   { type: 'ping' }                  -> { ok, type:'pong', platform, ... }
//   { type: 'exec', command, cwd? }   -> { ok, stdout, stderr, exitCode }
//
// It is intentionally dependency-free and single-file so the installer can copy
// it into app-data without an npm install step.
import { spawn } from 'node:child_process';
import { homedir, platform, arch, hostname } from 'node:os';

const MAX_OUTPUT_BYTES = 256_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const IS_WINDOWS = platform() === 'win32';

// --- native messaging framing ---

let buffer = Buffer.alloc(0);

function send(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(header);
  process.stdout.write(body);
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  drain();
});
process.stdin.on('end', () => process.exit(0));
process.stdin.on('error', () => process.exit(0));

function drain() {
  while (buffer.length >= 4) {
    const len = buffer.readUInt32LE(0);
    if (len === 0 || len > 64 * 1024 * 1024) {
      // Corrupt frame — give up rather than spin.
      process.exit(1);
    }
    if (buffer.length < 4 + len) return;
    const json = buffer.subarray(4, 4 + len).toString('utf8');
    buffer = buffer.subarray(4 + len);
    let msg;
    try {
      msg = JSON.parse(json);
    } catch {
      send({ ok: false, error: 'invalid_json' });
      continue;
    }
    handle(msg);
  }
}

function handle(msg) {
  const type = msg && typeof msg === 'object' ? msg.type : undefined;
  if (type === 'ping') {
    send({
      ok: true,
      type: 'pong',
      version: '1.0.0',
      platform: platform(),
      arch: arch(),
      hostname: hostname(),
      node: process.version,
    });
    return;
  }
  if (type === 'exec') {
    runCommand(msg);
    return;
  }
  send({ ok: false, error: `unknown_request_type: ${String(type)}` });
}

function runCommand(msg) {
  const command = typeof msg.command === 'string' ? msg.command.trim() : '';
  if (!command) {
    send({ ok: false, error: 'missing_command', exitCode: null });
    return;
  }
  const cwd = typeof msg.cwd === 'string' && msg.cwd.trim() ? msg.cwd.trim() : homedir();
  const timeoutMs =
    typeof msg.timeout_ms === 'number' && msg.timeout_ms >= 1000
      ? Math.min(msg.timeout_ms, MAX_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS;

  const shell = IS_WINDOWS ? 'powershell.exe' : process.env.SHELL || '/bin/sh';
  const args = IS_WINDOWS
    ? ['-NoProfile', '-NonInteractive', '-Command', command]
    : ['-c', command];

  let child;
  try {
    child = spawn(shell, args, { cwd, env: process.env, windowsHide: true });
  } catch (err) {
    send({ ok: false, error: err instanceof Error ? err.message : String(err), exitCode: null });
    return;
  }

  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let truncated = false;
  let settled = false;

  const collect = (target, chunk) => {
    const next = Buffer.concat([target === 'out' ? stdout : stderr, chunk]);
    if (next.length > MAX_OUTPUT_BYTES) {
      truncated = true;
      const sliced = next.subarray(0, MAX_OUTPUT_BYTES);
      if (target === 'out') stdout = sliced;
      else stderr = sliced;
    } else if (target === 'out') stdout = next;
    else stderr = next;
  };

  child.stdout.on('data', (c) => collect('out', c));
  child.stderr.on('data', (c) => collect('err', c));

  const timer = setTimeout(() => {
    if (settled) return;
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
    finish(null, 'timeout');
  }, timeoutMs);

  const finish = (code, error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    let out = stdout.toString('utf8');
    let err = stderr.toString('utf8');
    if (truncated) out += '\n…(输出过长已截断)';
    send({
      ok: !error && code === 0,
      stdout: out,
      stderr: err,
      exitCode: code,
      ...(error ? { error } : {}),
    });
  };

  child.on('error', (err) => finish(null, err.message));
  child.on('close', (code) => finish(code, null));
}
