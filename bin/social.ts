#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function resolveRepoRoot() {
  const localRoot = path.resolve(__dirname, '..');
  if (fs.existsSync(path.join(localRoot, 'cli')) || fs.existsSync(path.join(localRoot, 'dist-social'))) {
    return localRoot;
  }
  return path.resolve(localRoot, '..');
}

function hasSourceCli(rootDir) {
  return fs.existsSync(path.join(rootDir, 'cli', 'index.ts'));
}

function runSubprocess(entry, args) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    stdio: 'inherit',
    env: process.env
  });

  if (result.error) {
    // eslint-disable-next-line no-console
    console.error(String(result.error && result.error.message ? result.error.message : result.error));
    process.exit(1);
  }

  process.exit(result.status === null || result.status === undefined ? 1 : result.status);
}

function runLatestCli() {
  const repoRoot = resolveRepoRoot();
  const distCli = path.join(repoRoot, 'dist-social', 'cli', 'index.js');
  const sourceCli = path.join(repoRoot, 'cli', 'index.ts');
  const preferSource = hasSourceCli(path.resolve(__dirname, '..'));

  if (preferSource && fs.existsSync(sourceCli)) {
    try {
      // eslint-disable-next-line global-require
      const tsxCli = require.resolve('tsx/dist/cli.mjs');
      runSubprocess(tsxCli, [sourceCli, ...process.argv.slice(2)]);
      return;
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      // eslint-disable-next-line no-console
      console.error(`Unable to run Social Flow source CLI with tsx: ${message}`);
      process.exit(1);
    }
  }

  if (fs.existsSync(distCli)) {
    runSubprocess(distCli, process.argv.slice(2));
    return;
  }

  if (fs.existsSync(sourceCli)) {
    try {
      // eslint-disable-next-line global-require
      const tsxCli = require.resolve('tsx/dist/cli.mjs');
      runSubprocess(tsxCli, [sourceCli, ...process.argv.slice(2)]);
      return;
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      // eslint-disable-next-line no-console
      console.error(`Unable to run Social Flow source CLI with tsx: ${message}`);
      process.exit(1);
    }
  }

  // eslint-disable-next-line no-console
  console.error('Missing Social Flow CLI build. Run `npm run build:social-ts` or `npm install`.');
  process.exit(1);
}

runLatestCli();
