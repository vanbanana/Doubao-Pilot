#!/usr/bin/env node
// Copies the native-host source + one-click installers into public/host/ so they
// ship inside the extension and the self-check wizard can offer them for download
// (chrome.runtime.getURL('host/...')). Source of truth stays in /host.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'host');
const dest = resolve(root, 'public', 'host');

mkdirSync(dest, { recursive: true });
for (const file of readdirSync(src)) {
  copyFileSync(resolve(src, file), resolve(dest, file));
}
console.log(`synced ${readdirSync(src).length} host file(s) -> public/host`);
