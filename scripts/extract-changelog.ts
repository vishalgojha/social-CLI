#!/usr/bin/env node

/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

function usage() {
  console.error('Usage: node dist-legacy/scripts/extract-changelog.js <version> [--allow-missing]');
  process.exit(2);
}

const version = process.argv[2];
if (!version) usage();

const allowMissing = process.argv.includes('--allow-missing');

const rootFromDist = path.resolve(__dirname, '..', '..');
const rootFromSource = path.resolve(__dirname, '..');
const repoRoot = fs.existsSync(path.join(rootFromSource, 'CHANGELOG.md')) ? rootFromSource : rootFromDist;
const changelogPath = path.join(repoRoot, 'CHANGELOG.md');
const text = fs.readFileSync(changelogPath, 'utf8');

// Match "## x.y.z" section until next "## " header.
const re = new RegExp(`^##\\s+${version.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*$([\\s\\S]*?)(^##\\s+|\\Z)`, 'm');
const m = text.match(re);
if (!m) {
  if (!allowMissing) {
    console.error(`Changelog entry not found for version ${version} in CHANGELOG.md`);
    process.exit(1);
  }
  console.log(`- Release v${version}.\n`);
  process.exit(0);
}

const body = (m[1] || '').trim();
if (!body) {
  if (!allowMissing) {
    console.error(`Changelog entry for ${version} is empty`);
    process.exit(1);
  }
  console.log(`- Release v${version}.\n`);
  process.exit(0);
}

console.log(body + '\n');
