#!/usr/bin/env node

const { Command } = require('commander');
const packageJson = require('../package.json');
const { getBanner } = require('../lib/banner');

const program = new Command();

// Import command modules
const authCommands = require('../commands/auth');
const queryCommands = require('../commands/query');
const appCommands = require('../commands/app');
const limitsCommands = require('../commands/limits');
const postCommands = require('../commands/post');
const whatsappCommands = require('../commands/whatsapp');
const instagramCommands = require('../commands/instagram');
const utilsCommands = require('../commands/utils');
const agentCommands = require('../commands/agent');
const marketingCommands = require('../commands/marketing');

function getArgValue(name) {
  // Supports: --flag value, --flag=value
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('-')) return process.argv[idx + 1];
  const pref = name + '=';
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : '';
}

function hasArg(name) {
  return process.argv.includes(name) || process.argv.some((a) => a.startsWith(name + '='));
}

function getChalkForBanner() {
  const chalkLib = require('chalk'); // eslint-disable-line global-require

  const noColor = Boolean(process.env.NO_COLOR) || hasArg('--no-color');
  const forceColor = Boolean(process.env.FORCE_COLOR) || hasArg('--color') || hasArg('--force-color');

  if (noColor) return new chalkLib.Instance({ level: 0 });
  if (forceColor) return new chalkLib.Instance({ level: 3 });

  const level = chalkLib.supportsColor ? chalkLib.supportsColor.level : 0;
  return new chalkLib.Instance({ level });
}

function showBanner() {
  const chalk = getChalkForBanner();

  const styleArg = getArgValue('--banner-style');
  const style = (styleArg || process.env.META_CLI_BANNER_STYLE || 'classic').toLowerCase();
  const banner = getBanner(style);

  const lines = String(banner).split('\n');
  const palette = [
    (s) => chalk.cyanBright(s),
    (s) => chalk.blueBright(s),
    (s) => chalk.cyan(s),
    (s) => chalk.blue(s),
    (s) => chalk.cyanBright(s)
  ];
  const colored = lines.map((l, i) => palette[i % palette.length](l)).join('\n');

  console.log(colored);
  console.log(chalk.yellow('For devs tired of token gymnastics'));
  console.log(chalk.green('Built by Chaos Craft Labs.'));
  console.log('');
}

const shouldShowBanner = process.argv.length <= 2 ||
  process.argv.includes('--help') ||
  process.argv.includes('-h');

if (shouldShowBanner && !process.argv.includes('--no-banner')) {
  showBanner();
}

program
  .name('meta')
  .description('A CLI for Meta\'s APIs. For devs tired of token gymnastics.')
  .option('--no-banner', 'Disable the startup banner')
  .option('--banner-style <style>', 'Banner style: classic|slant|clean|compact', process.env.META_CLI_BANNER_STYLE || 'classic')
  .option('--color', 'Force colored output (overrides auto-detection)')
  .option('--no-color', 'Disable colored output')
  .version(packageJson.version);

// Register command groups
authCommands(program);
queryCommands(program);
appCommands(program);
limitsCommands(program);
postCommands(program);
whatsappCommands(program);
instagramCommands(program);
utilsCommands(program);
agentCommands(program);
marketingCommands(program);

// Custom help
program.on('--help', () => {
  const chalk = getChalkForBanner();
  console.log('');
  console.log(chalk.yellow('Examples:'));
  console.log('  $ meta auth login              ' + chalk.gray('# Authenticate with Meta'));
  console.log('  $ meta query me                ' + chalk.gray('# Get your profile info'));
  console.log('  $ meta app info                ' + chalk.gray('# View app configuration'));
  console.log('  $ meta limits check            ' + chalk.gray('# Check rate limits'));
  console.log('  $ meta post create --message "Hello" --page PAGE_ID  ' + chalk.gray('# Create a Page post'));
  console.log('  $ meta whatsapp send --from PHONE_ID --to +15551234567 --body "Hello"  ' + chalk.gray('# Send a WhatsApp message'));
  console.log('  $ meta instagram accounts list ' + chalk.gray('# List connected IG accounts'));
  console.log('  $ meta utils config show       ' + chalk.gray('# Show config + defaults'));
  console.log('  $ meta agent "fix whatsapp webhook for clientA"  ' + chalk.gray('# Plan first, then execute with confirmation'));
  console.log('  $ meta marketing accounts      ' + chalk.gray('# List ad accounts'));
  console.log('');
  console.log(chalk.cyan('Documentation: https://github.com/vishalgojha/meta-cli'));
});

program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
