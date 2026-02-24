import path = require('path');
import { spawn } from 'child_process';
import chalk = require('chalk');

const config = require('../../lib/config');
const { PersistentMemory } = require('../../lib/chat/memory');
const { buildSessionTimeline } = require('../../lib/chat/timeline');

function printSessions() {
  const sessions = PersistentMemory.list(30);
  if (!sessions.length) {
    console.log(chalk.gray('\nNo chat sessions found.\n'));
    return;
  }
  console.log(chalk.bold('\nRecent Chat Sessions:'));
  sessions.forEach((s: any) => {
    console.log(`- ${chalk.cyan(s.sessionId)} (${s.updatedAt})`);
  });
  console.log('');
}

function printReplay(sessionId: string, limit = 120) {
  const memory = new PersistentMemory(sessionId);
  if (!memory.exists()) {
    console.log(chalk.red(`\nSession not found: ${sessionId}\n`));
    return;
  }
  const saved = memory.load() || {};
  const context = saved?.context && typeof saved.context === 'object' ? saved.context : {};
  const timeline = buildSessionTimeline(context, { limit });
  if (!timeline.length) {
    console.log(chalk.gray('\nNo timeline entries found for this session.\n'));
    return;
  }
  console.log(chalk.bold(`\nSession Replay: ${sessionId}`));
  timeline.forEach((row: any) => {
    const ts = row.at ? new Date(row.at).toLocaleString() : '-';
    const role = String(row.role || row.type || '').toUpperCase();
    const text = String(row.text || '').trim();
    console.log(`- [${ts}] ${role}: ${text}`);
  });
  console.log('');
}

function needsOnboarding() {
  return !config.hasCompletedOnboarding();
}

function runSubprocess(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const binPath = path.join(__dirname, '..', '..', '..', 'dist-legacy', 'bin', 'social.js');
    const child = spawn(process.execPath, [binPath, '--no-banner', ...args], {
      stdio: 'inherit',
      env: process.env
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`social ${args.join(' ')} exited with code ${code}`));
    });
  });
}

function registerChatCommands(program: any) {
  const chat = program
    .command('chat')
    .description('Legacy alias to hatch (agentic terminal chat)')
    .action(async () => {
      if (needsOnboarding()) {
        console.log(chalk.yellow('\nFirst-run setup required before chat.'));
        console.log(chalk.gray('Guided path: onboard -> auth login -> doctor checks.\n'));
        await runSubprocess(['onboard']);
        return;
      }

      console.log(chalk.cyan('\n`social chat` is now routed to Hatch UI. Use `social hatch` directly.\n'));
      await runSubprocess(['hatch']);
    });

  chat
    .command('sessions')
    .description('List recent chat sessions')
    .action(() => {
      printSessions();
    });

  chat
    .command('replay <sessionId>')
    .description('Replay timeline for a saved session')
    .option('--limit <n>', 'Max timeline events', '120')
    .action((sessionId: string, opts: { limit?: string }) => {
      const limit = Math.max(1, Number(opts.limit || 120));
      printReplay(sessionId, limit);
    });
}

export = registerChatCommands;
