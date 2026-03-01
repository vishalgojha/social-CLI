#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

type ReleaseArgs = {
  bump: 'patch' | 'minor' | 'major';
  dryRun: boolean;
  skipQuality: boolean;
};

const VALID_BUMPS = new Set<ReleaseArgs['bump']>(['patch', 'minor', 'major']);
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const gitCmd = process.platform === 'win32' ? 'git.exe' : 'git';

function usage(exitCode = 0): never {
  // eslint-disable-next-line no-console
  console.log(
    [
      'Usage: tsx scripts/release.ts <patch|minor|major> [--dry-run] [--skip-quality]',
      '',
      'Examples:',
      '  npm run release:patch',
      '  npm run release:minor',
      '  npm run release:dry-run',
      '',
      'Optional env:',
      '  NPM_OTP=123456 npm run release:patch'
    ].join('\n')
  );
  process.exit(exitCode);
}

function run(command: string, args: string[], options: Record<string, unknown> = {}): void {
  const printable = `${command} ${args.join(' ')}`.trim();
  // eslint-disable-next-line no-console
  console.log(`\n$ ${printable}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function capture(command: string, args: string[], options: Record<string, unknown> = {}): string {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = String(result.stderr || '').trim();
    throw new Error(stderr || `${command} ${args.join(' ')} failed`);
  }
  return String(result.stdout || '');
}

function readPackageJson(): { name: string; version: string } {
  const packagePath = path.resolve(process.cwd(), 'package.json');
  const raw = fs.readFileSync(packagePath, 'utf8');
  return JSON.parse(raw);
}

function ensureCleanWorkingTree(): void {
  const status = capture(gitCmd, ['status', '--porcelain']).trim();
  if (!status) return;
  // eslint-disable-next-line no-console
  console.error('Release aborted: git working tree is not clean.');
  // eslint-disable-next-line no-console
  console.error('Commit or stash changes before running release.');
  process.exit(1);
}

function parseCliArgs(argv: string[]): ReleaseArgs {
  const positionals: string[] = [];
  const flags = new Set<string>();

  for (const arg of argv) {
    if (arg.startsWith('--')) flags.add(arg);
    else positionals.push(arg);
  }

  if (flags.has('--help') || flags.has('-h')) usage(0);

  const bumpRaw = positionals[0] || 'patch';
  if (!VALID_BUMPS.has(bumpRaw as ReleaseArgs['bump'])) {
    // eslint-disable-next-line no-console
    console.error(`Invalid bump "${bumpRaw}". Use patch, minor, or major.`);
    usage(1);
  }

  const allowedFlags = new Set(['--dry-run', '--skip-quality', '--help', '-h']);
  for (const flag of flags) {
    if (!allowedFlags.has(flag)) {
      // eslint-disable-next-line no-console
      console.error(`Unknown flag "${flag}".`);
      usage(1);
    }
  }

  return {
    bump: bumpRaw as ReleaseArgs['bump'],
    dryRun: flags.has('--dry-run'),
    skipQuality: flags.has('--skip-quality')
  };
}

function main(): void {
  const args = parseCliArgs(process.argv.slice(2));
  const packageJson = readPackageJson();

  // eslint-disable-next-line no-console
  console.log(`[release] target package: ${packageJson.name}`);
  // eslint-disable-next-line no-console
  console.log(`[release] current version: ${packageJson.version}`);

  ensureCleanWorkingTree();

  run(npmCmd, ['whoami']);

  if (!args.skipQuality) {
    run(npmCmd, ['run', 'quality:check']);
  } else {
    // eslint-disable-next-line no-console
    console.log('[release] skipping quality checks (--skip-quality)');
  }

  if (args.dryRun) {
    run(npmCmd, ['pack', '--dry-run']);
    // eslint-disable-next-line no-console
    console.log('\n[release] dry-run complete (no version bump, no publish).');
    return;
  }

  run(npmCmd, ['version', args.bump]);

  const bumped = readPackageJson();
  const publishArgs = ['publish', '--access', 'public'];
  if (process.env.NPM_OTP) {
    publishArgs.push('--otp', process.env.NPM_OTP);
  }
  run(npmCmd, publishArgs);

  const publishedVersion = capture(npmCmd, ['view', bumped.name, 'version']).trim();
  if (publishedVersion !== bumped.version) {
    // eslint-disable-next-line no-console
    console.error(
      `[release] publish verification failed: expected ${bumped.version}, got ${publishedVersion || '(empty)'}`
    );
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`\n[release] published ${bumped.name}@${bumped.version}`);
  // eslint-disable-next-line no-console
  console.log('[release] next: git push origin main --follow-tags');
}

main();
