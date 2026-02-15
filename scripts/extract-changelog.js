#!/usr/bin/env node

/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

function usage() {
  console.error('Usage: node scripts/extract-changelog.js <version>');
  process.exit(2);
}

const version = process.argv[2];
if (!version) usage();

const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
const text = fs.readFileSync(changelogPath, 'utf8');

// Match "## x.y.z" section until next "## " header.
const re = new RegExp(`^##\\s+${version.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*$([\\s\\S]*?)(^##\\s+|\\Z)`, 'm');
const m = text.match(re);
if (!m) {
  console.error(`Changelog entry not found for version ${version} in CHANGELOG.md`);
  process.exit(1);
}

const body = (m[1] || '').trim();
if (!body) {
  console.error(`Changelog entry for ${version} is empty`);
  process.exit(1);
}

console.log(body + '\n');

