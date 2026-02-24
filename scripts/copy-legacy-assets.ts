#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const rootFromSource = path.resolve(__dirname, '..');
const rootFromDist = path.resolve(__dirname, '..', '..');
const repoRoot = fs.existsSync(path.join(rootFromSource, 'tsconfig.legacy.json')) ? rootFromSource : rootFromDist;
const distRoot = path.join(repoRoot, 'dist-legacy');

function copyFileRel(relPath: string): void {
  const src = path.join(repoRoot, relPath);
  const dst = path.join(distRoot, relPath);
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

copyFileRel('package.json');
copyFileRel(path.join('lib', 'ai', 'intent-contract.json'));
copyFileRel(path.join('lib', 'ai', 'intents.json'));
