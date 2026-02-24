#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ZERO_SHA = '0000000000000000000000000000000000000000';

function runGit(args, fallback = '') {
  try {
    return cp.execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
}

function parseArgs(argv) {
  const out = {
    remote: '',
    url: '',
    updatesFile: '',
    timeoutMs: 45000,
    pollMs: 1500
  };
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i];
    if (v === '--remote') out.remote = String(argv[i + 1] || '').trim();
    if (v === '--url') out.url = String(argv[i + 1] || '').trim();
    if (v === '--updates-file') out.updatesFile = String(argv[i + 1] || '').trim();
    if (v === '--timeout-ms') out.timeoutMs = Number(argv[i + 1] || 0) || out.timeoutMs;
    if (v === '--poll-ms') out.pollMs = Number(argv[i + 1] || 0) || out.pollMs;
  }
  return out;
}

function parsePushLines(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      if (parts.length < 4) return null;
      return {
        line,
        localRef: parts[0],
        localSha: parts[1],
        remoteRef: parts[2],
        remoteSha: parts[3]
      };
    })
    .filter(Boolean)
    .filter((x) => x.localSha !== ZERO_SHA);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function remoteShaForRef(remoteTarget, ref) {
  if (!remoteTarget || !ref) return '';
  const raw = runGit(['ls-remote', '--refs', remoteTarget, ref], '');
  if (!raw) return '';
  const first = raw.split(/\r?\n/)[0] || '';
  const sha = first.trim().split(/\s+/)[0] || '';
  return sha.trim();
}

function emitHandoff({ repoRoot, remote, url, updates }) {
  if (!updates.length) return;
  const writer = path.join(repoRoot, 'dist-legacy', 'scripts', 'write-codex-handoff.js');
  if (!fs.existsSync(writer)) return;
  const input = `${updates.map((u) => u.line).join('\n')}\n`;
  try {
    cp.execFileSync('node', [writer, '--remote', remote || '', '--url', url || ''], {
      cwd: repoRoot,
      input,
      stdio: ['pipe', 'ignore', 'ignore']
    });
  } catch {
    // Ignore failures in detached monitor.
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.updatesFile || !fs.existsSync(args.updatesFile)) return;

  const raw = fs.readFileSync(args.updatesFile, 'utf8');
  const updates = parsePushLines(raw);
  try {
    fs.unlinkSync(args.updatesFile);
  } catch {
    // ignore
  }
  if (!updates.length) return;

  const repoRoot = runGit(['rev-parse', '--show-toplevel'], process.cwd());
  const remoteTarget = args.remote || args.url || 'origin';
  const deadline = Date.now() + Math.max(3000, Number(args.timeoutMs || 45000));

  while (Date.now() < deadline) {
    const matched = updates.filter((u) => {
      const current = remoteShaForRef(remoteTarget, u.remoteRef);
      return Boolean(current) && current === u.localSha;
    });
    if (matched.length > 0) {
      emitHandoff({
        repoRoot,
        remote: args.remote,
        url: args.url,
        updates: matched
      });
      return;
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(Math.max(250, Number(args.pollMs || 1500)));
  }
}

main().catch(() => {
  // Keep monitor silent by design.
});
